/**
 * KZO-166 — Currency Wallet WAC + Realized FX P&L
 *
 * Pure module. No I/O, no persistence imports. All math is deterministic and
 * testable without any infrastructure.
 *
 * Algorithm outline:
 *   - applyEntryToWalletState: walks cash-ledger entries in deterministic order
 *     (entry_date ASC, booked_at ASC, id ASC — enforced by the caller via
 *     getCashLedgerEntriesForWalletReplay) and updates WAC + realized FX P&L.
 *   - computeRealizedFxPnl: thin helper extracted so unit tests can verify
 *     the formula directly: (saleRate − wac) × amountSold.
 *
 * Typed errors:
 *   - WalletAccountingError — shared base for route-boundary catches.
 *   - InsufficientWalletBalanceError — outflow > available balance, or outflow
 *     with WAC=null (degenerate — defect in upstream data).
 *   - MissingFxRateError — read-path or future write-path callers that need
 *     an FX rate but find none (getFxRate returned null). The wallet generator
 *     does NOT throw this in KZO-166 — it trusts pre-stamped entries.
 *
 * Route-boundary catch pattern (KZO-168 future wiring):
 *   catch (err) {
 *     if (err instanceof WalletAccountingError)
 *       throw routeError(500, "wallet_accounting_failed", err.message);
 *     throw err;
 *   }
 *
 * Decimal precision:
 *   - WAC intermediate: full floating-point precision.
 *   - wacFxToUsd at write: roundToDecimal(wac, 8).
 *   - balance and realizedFxPnlLifetime at write: roundToDecimal(val, 2).
 *   - balance and realizedFxPnlLifetime: rounded to 2dp at each step within
 *     this module (consistent with architect-design §3 pseudocode).
 *   - wacFxToUsd: full precision here; caller rounds to 8dp at snapshot-write.
 */
import { roundToDecimal } from "@tw-portfolio/domain";

// ── Types ──────────────────────────────────────────────────────────────────

export type WalletState = {
  /** Native currency balance. NUMERIC(20, 2). 0 means empty wallet. */
  balance: number;
  /**
   * Weighted-average FX rate (native → USD). `null` IFF balance is 0 or no
   * FX-rate-stamped inflow has occurred yet. The next inflow with a non-null
   * fxRateToUsd will re-seed the WAC (no weighting against the prior null).
   */
  wacFxToUsd: number | null;
  /**
   * USD-denominated, signed net P&L. Cumulative since genesis. A loss
   * subtracts. NUMERIC(20, 2). Reset to 0 only on full account purge.
   */
  realizedFxPnlLifetime: number;
};

export type WalletEntry = {
  /** Native, signed. Positive = inflow, negative = outflow. */
  amount: number;
  /** Non-null only on FX-conversion entries (native → USD). */
  fxRateToUsd: number | null;
  /** YYYY-MM-DD. Used only for error context. */
  entryDate: string;
  /** Currency identifier — used only for error context; math is currency-agnostic. */
  currency: string;
  /** Account identifier — used only for error context. */
  accountId: string;
};

// ── Typed errors ───────────────────────────────────────────────────────────

export class WalletAccountingError extends Error {
  constructor(
    message: string,
    public readonly context: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WalletAccountingError";
  }
}

export class InsufficientWalletBalanceError extends WalletAccountingError {
  constructor(
    public readonly details: {
      accountId: string;
      currency: string;
      available: number;
      requested: number;
      entryDate: string;
      fxRateToUsd: number | null;
    },
  ) {
    super(
      `Insufficient ${details.currency} wallet balance for FX outflow on ${details.entryDate}: ` +
        `available ${details.available}, requested ${details.requested}`,
      { ...details },
    );
    this.name = "InsufficientWalletBalanceError";
  }
}

export class MissingFxRateError extends WalletAccountingError {
  constructor(
    public readonly details: {
      base: string;
      quote: string;
      asOfDate: string;
    },
  ) {
    super(
      `No FX rate available for ${details.base}/${details.quote} at or before ${details.asOfDate}`,
      { ...details },
    );
    this.name = "MissingFxRateError";
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Compute realized FX P&L for an outflow:
 *   (saleRate − wac) × amountSold
 *
 * Result is in USD, signed. Positive = gain (sold at higher rate than WAC).
 * Negative = loss (sold at lower rate than WAC).
 *
 * Caller must pass `amountSold` as a positive value (absolute sell size).
 * Result is at full floating-point precision; caller rounds to 2dp.
 */
export function computeRealizedFxPnl(
  wac: number,
  saleRate: number,
  amountSold: number,
): number {
  return (saleRate - wac) * amountSold;
}

/**
 * Apply one cash-ledger entry to the running WalletState.
 *
 * Cases:
 *   A: fxRateToUsd === null → balance += amount, WAC + realized unchanged.
 *   B: fxRateToUsd !== null, amount > 0 → weighted-average WAC update.
 *   C: fxRateToUsd !== null, amount < 0 → crystallize realized FX P&L.
 *   D: fxRateToUsd !== null, amount === 0 → return prev unchanged (DB CHECK
 *      prevents this; defensive guard only).
 *
 * Throws InsufficientWalletBalanceError on:
 *   - outflow (amount < 0) that would take balance negative.
 *   - outflow with WAC=null (degenerate state — defect in upstream data).
 *
 * WAC precision: full floating-point throughout; caller rounds at write time.
 */
export function applyEntryToWalletState(prev: WalletState, entry: WalletEntry): WalletState {
  const { amount, fxRateToUsd, entryDate, currency, accountId } = entry;

  // Case A: no FX rate stamped
  if (fxRateToUsd === null) {
    return {
      balance: roundToDecimal(prev.balance + amount, 2),
      wacFxToUsd: prev.wacFxToUsd,
      realizedFxPnlLifetime: prev.realizedFxPnlLifetime,
    };
  }

  // Case D: zero-amount FX entry (defensive; DB CHECK amount <> 0 prevents this)
  if (amount === 0) {
    return { ...prev };
  }

  // Case B: FX rate stamped, inflow
  if (amount > 0) {
    const newBalance = prev.balance + amount;
    let newWac: number;
    if (prev.wacFxToUsd === null || prev.balance === 0) {
      // Re-seed WAC — no weighting against a null/zero prior state.
      newWac = fxRateToUsd;
    } else {
      const prevUsdCost = prev.balance * prev.wacFxToUsd;
      const newUsdCost = amount * fxRateToUsd;
      newWac = (prevUsdCost + newUsdCost) / newBalance;
    }
    return {
      balance: roundToDecimal(newBalance, 2),
      wacFxToUsd: newWac,
      realizedFxPnlLifetime: prev.realizedFxPnlLifetime,
    };
  }

  // Case C: FX rate stamped, outflow (amount < 0)
  const requestedAbsolute = Math.abs(amount);

  if (prev.balance + amount < 0) {
    throw new InsufficientWalletBalanceError({
      accountId,
      currency,
      available: prev.balance,
      requested: requestedAbsolute,
      entryDate,
      fxRateToUsd,
    });
  }

  if (prev.wacFxToUsd === null) {
    // Outflow before any inflow — degenerate state; treat as a defect.
    throw new InsufficientWalletBalanceError({
      accountId,
      currency,
      available: prev.balance,
      requested: requestedAbsolute,
      entryDate,
      fxRateToUsd,
    });
  }

  const realized = computeRealizedFxPnl(prev.wacFxToUsd, fxRateToUsd, requestedAbsolute);
  const newBalance = roundToDecimal(prev.balance + amount, 2);
  // WAC is unchanged after a partial sell (AC3). When balance goes to exactly
  // 0, reset WAC to null so the next inflow re-seeds it (D11 backward compat).
  const newWac = newBalance === 0 ? null : prev.wacFxToUsd;

  return {
    balance: newBalance,
    wacFxToUsd: newWac,
    realizedFxPnlLifetime: roundToDecimal(prev.realizedFxPnlLifetime + realized, 2),
  };
}
