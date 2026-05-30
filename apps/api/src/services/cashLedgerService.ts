import { roundToDecimal } from "@vakwen/domain";
import type { AccountDto } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import {
  appendCashLedgerEntry,
  replaceCashLedgerEntryForTrade,
} from "./accountingStore.js";
import type { CashLedgerEntry, Store, Transaction } from "../types/store.js";

/**
 * KZO-167 service-layer guard: assert that a cash ledger entry's currency
 * matches the booking account's `defaultCurrency`. The complementary write
 * lockdown lives in `PATCH /accounts/:id` (see registerRoutes.ts) — these
 * two together ensure no drift can be introduced from any normal entry path.
 *
 * Throws `routeError(400, "currency_mismatch", ...)` on mismatch.
 */
export function assertCashEntryCurrencyMatchesAccount(
  entry: CashLedgerEntry,
  account: AccountDto,
): void {
  if (entry.currency !== account.defaultCurrency) {
    throw routeError(
      400,
      "currency_mismatch",
      `Cash ledger entry currency ${entry.currency} does not match account ${account.id} default currency ${account.defaultCurrency}`,
    );
  }
}

/**
 * KZO-167 path-1 wrapper: book a single cash ledger entry through the
 * currency-match guard before delegating to `appendCashLedgerEntry`. Used by
 * the initial trade-booking path (`portfolio.ts`).
 *
 * Throws:
 * - `routeError(404, "account_not_found", ...)` when the entry references an
 *   account that is not present in `store.accounts`.
 * - `routeError(400, "currency_mismatch", ...)` when entry.currency differs
 *   from the account's `defaultCurrency`.
 */
export function bookCashLedgerEntry(store: Store, entry: CashLedgerEntry): void {
  const account = store.accounts.find((item) => item.id === entry.accountId);
  if (!account) {
    throw routeError(
      404,
      "account_not_found",
      `Account ${entry.accountId} not found while booking cash ledger entry ${entry.id}`,
    );
  }
  assertCashEntryCurrencyMatchesAccount(entry, account);
  appendCashLedgerEntry(store, entry);
}

/**
 * KZO-167 path-3 wrapper: build the trade-settlement cash entry for a
 * recompute, run the currency-match guard, and replace the existing trade
 * cash entry. Used by `recompute.ts` confirm path.
 */
export function bookTradeSettlementRecompute(store: Store, tx: Transaction): void {
  const account = store.accounts.find((item) => item.id === tx.accountId);
  if (!account) {
    throw routeError(
      404,
      "account_not_found",
      `Account ${tx.accountId} not found while recomputing trade settlement for ${tx.id}`,
    );
  }
  const entry = buildTradeSettlementCashEntry(tx);
  assertCashEntryCurrencyMatchesAccount(entry, account);
  replaceCashLedgerEntryForTrade(store, tx.id, entry);
}

/**
 * KZO-167: consolidated trade-settlement cash entry builder. Previously
 * duplicated between `portfolio.ts` (initial booking) and `recompute.ts`
 * (fee-profile recompute). The recompute call site relied on a richer
 * currency fallback (`tx.priceCurrency ?? tx.feeSnapshot.commissionCurrency
 * ?? "TWD"`) — that fallback is preserved here so both call sites use the
 * same shape.
 */
export function buildTradeSettlementCashEntry(tx: Transaction): CashLedgerEntry {
  const grossTradeValueAmount = roundToDecimal(tx.quantity * tx.unitPrice, 2);
  const settlementAmount =
    tx.type === "BUY"
      ? -(grossTradeValueAmount + tx.commissionAmount + tx.taxAmount)
      : grossTradeValueAmount - tx.commissionAmount - tx.taxAmount;

  return {
    id: `cash-${tx.id}`,
    userId: tx.userId,
    accountId: tx.accountId,
    entryDate: tx.tradeDate,
    entryType: tx.type === "BUY" ? "TRADE_SETTLEMENT_OUT" : "TRADE_SETTLEMENT_IN",
    amount: settlementAmount,
    currency: tx.priceCurrency ?? tx.feeSnapshot.commissionCurrency ?? "TWD",
    relatedTradeEventId: tx.id,
    source: "trade_settlement",
    sourceReference: tx.id,
    bookedAt: tx.bookedAt,
  };
}
