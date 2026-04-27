// KZO-166 — Senior QA Phase 1 (Tier 2 parallel).
//
// Unit tests for the pure WAC helpers in `currencyWalletAccounting.ts`.
// No I/O, no mocks — these target the deterministic math layer only.
//
// Tests are TDD-red until the Implementer creates
// `apps/api/src/services/currencyWalletAccounting.ts`.
//
// AC mapping:
//   AC1 — WAC weighted-average formula across multiple inflows
//   AC2 — realized FX P&L crystallized on outflow (gain and loss cases)
//   AC3 — WAC unchanged after partial sell (only balance decreases)
//   D9  — InsufficientWalletBalanceError with structured details
//   D12 — decimal rounding at boundary (roundToDecimal enforced by helper)
import { describe, expect, it } from "vitest";

// TDD-red until Implementer creates this module.
import {
  applyEntryToWalletState,
  computeRealizedFxPnl,
  InsufficientWalletBalanceError,
  type WalletEntry,
  type WalletState,
} from "../../src/services/currencyWalletAccounting.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyState(): WalletState {
  return { balance: 0, wacFxToUsd: null, realizedFxPnlLifetime: 0 };
}

function entry(overrides: Partial<WalletEntry> = {}): WalletEntry {
  return {
    amount: 100,
    fxRateToUsd: null,
    entryDate: "2026-01-10",
    currency: "TWD",
    accountId: "acc-1",
    ...overrides,
  };
}

// ── computeRealizedFxPnl ───────────────────────────────────────────────────────

describe("computeRealizedFxPnl", () => {
  it("gain case: (saleRate − wac) × amountSold is positive (AC2)", () => {
    // WAC=0.032, sale at 0.034, sold 500 TWD → $1.00 gain
    const result = computeRealizedFxPnl(0.032, 0.034, 500);
    expect(result).toBeCloseTo(1.0, 10);
  });

  it("loss case: (saleRate − wac) × amountSold is negative (AC2)", () => {
    // WAC=0.034, sale at 0.032, sold 500 TWD → -$1.00 loss
    const result = computeRealizedFxPnl(0.034, 0.032, 500);
    expect(result).toBeCloseTo(-1.0, 10);
  });

  it("break-even case: saleRate === wac → realized is 0", () => {
    const result = computeRealizedFxPnl(0.032, 0.032, 1000);
    expect(result).toBeCloseTo(0, 10);
  });

  it("small-amount precision: math is not float-mangled for tiny FX values", () => {
    // TWD/USD rate ≈ 0.031, sold 1 TWD → ~0 realized change when same rate
    const result = computeRealizedFxPnl(0.031, 0.031, 1);
    expect(result).toBeCloseTo(0, 8);
  });
});

// ── applyEntryToWalletState — Case A: no FX rate ─────────────────────────────

describe("applyEntryToWalletState — Case A (fxRateToUsd: null)", () => {
  it("non-FX inflow: updates balance, WAC and realized unchanged (AC1/AC2)", () => {
    // AC1 prerequisite: entries without FX rate do not touch WAC
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: 500, fxRateToUsd: null }));

    expect(next.balance).toBe(1500);
    expect(next.wacFxToUsd).toBe(0.032);   // unchanged
    expect(next.realizedFxPnlLifetime).toBe(0);  // unchanged
  });

  it("non-FX outflow from a funded wallet: balance decreases, WAC and realized unchanged", () => {
    // Edge: non-FX entries (AC2 companion — non-FX path does NOT crystallize P&L)
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.032, realizedFxPnlLifetime: 5.0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -200, fxRateToUsd: null }));

    expect(next.balance).toBe(800);
    expect(next.wacFxToUsd).toBe(0.032);   // unchanged
    expect(next.realizedFxPnlLifetime).toBe(5.0);  // unchanged
  });

  it("zero-amount non-FX entry: returns prev unchanged (Case D defensive guard)", () => {
    // D15 / D4: amount=0 is blocked by DB CHECK; pure helper returns prev unchanged.
    const prev: WalletState = { balance: 500, wacFxToUsd: 0.030, realizedFxPnlLifetime: 2.0 };
    const next = applyEntryToWalletState(prev, entry({ amount: 0, fxRateToUsd: 0.032 }));

    expect(next).toEqual(prev);
  });
});

// ── applyEntryToWalletState — Case B: FX inflow ───────────────────────────────

describe("applyEntryToWalletState — Case B (FX inflow, amount > 0)", () => {
  it("AC1.1: three TWD inflows — WAC computed by weighted-average formula (AC1)", () => {
    // Inflow 1: 100 TWD at rate 0.030
    const s0 = emptyState();
    const s1 = applyEntryToWalletState(s0, entry({ amount: 100, fxRateToUsd: 0.030 }));

    expect(s1.balance).toBe(100);
    expect(s1.wacFxToUsd).toBeCloseTo(0.030, 8);

    // Inflow 2: 200 TWD at rate 0.032
    // WAC = (100×0.030 + 200×0.032) / 300 = (3 + 6.4) / 300 = 0.031333…
    const s2 = applyEntryToWalletState(s1, entry({ amount: 200, fxRateToUsd: 0.032 }));

    expect(s2.balance).toBe(300);
    expect(s2.wacFxToUsd).toBeCloseTo(9.4 / 300, 8);

    // Inflow 3: 100 TWD at rate 0.034
    // WAC = (300 × 0.031333… + 100 × 0.034) / 400 = (9.4 + 3.4) / 400 = 12.8 / 400 = 0.032
    const s3 = applyEntryToWalletState(s2, entry({ amount: 100, fxRateToUsd: 0.034 }));

    expect(s3.balance).toBe(400);
    expect(s3.wacFxToUsd).toBeCloseTo(0.032, 8);
    expect(s3.realizedFxPnlLifetime).toBe(0);
  });

  it("first inflow into empty wallet seeds WAC directly (no weighting against null)", () => {
    // AC1 re-seed rule: wacFxToUsd is null before first inflow
    const next = applyEntryToWalletState(emptyState(), entry({ amount: 500, fxRateToUsd: 0.034 }));

    expect(next.balance).toBe(500);
    expect(next.wacFxToUsd).toBe(0.034);
  });

  it("inflow when prev.wacFxToUsd is null but balance > 0: re-seeds WAC (no weighting against null)", () => {
    // Edge: non-FX entries pushed balance up, but wacFxToUsd remains null.
    // First FX inflow should re-seed without weighting.
    const prev: WalletState = { balance: 200, wacFxToUsd: null, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: 300, fxRateToUsd: 0.040 }));

    expect(next.balance).toBe(500);
    // Re-seed: wacFxToUsd = entry.fxRateToUsd, not weighted against the null
    expect(next.wacFxToUsd).toBe(0.040);
  });

  it("inflow after balance was zeroed: WAC is re-seeded, not weighted against prior null (AC1 edge)", () => {
    // Balance goes to 0 after outflow → WAC resets to null.
    // Next inflow must re-seed WAC (not weight against null).
    const s0: WalletState = { balance: 500, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };

    // Outflow zeroes the wallet
    const s1 = applyEntryToWalletState(s0, entry({ amount: -500, fxRateToUsd: 0.034 }));
    expect(s1.balance).toBe(0);
    expect(s1.wacFxToUsd).toBeNull();  // reset on zero-balance

    // Re-inflow at new rate
    const s2 = applyEntryToWalletState(s1, entry({ amount: 200, fxRateToUsd: 0.040 }));
    expect(s2.balance).toBe(200);
    expect(s2.wacFxToUsd).toBe(0.040);  // re-seeded, not weighted
  });
});

// ── applyEntryToWalletState — Case C: FX outflow ─────────────────────────────

describe("applyEntryToWalletState — Case C (FX outflow, amount < 0)", () => {
  it("AC2: gain case — outflow at higher rate than WAC crystallizes positive realized P&L", () => {
    // TWD wallet: WAC=0.032 balance=1000, sell 500 at 0.034
    // realized = (0.034 - 0.032) × 500 = 1.00
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -500, fxRateToUsd: 0.034 }));

    expect(next.balance).toBe(500);
    expect(next.realizedFxPnlLifetime).toBeCloseTo(1.0, 2);
    expect(next.wacFxToUsd).toBe(0.032);  // AC3: WAC unchanged
  });

  it("AC3: partial sell — WAC is unchanged after outflow (only balance decreases)", () => {
    // Same as AC2 gain case — explicit AC3 assertion
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -500, fxRateToUsd: 0.034 }));

    expect(next.wacFxToUsd).toBe(0.032);
    expect(next.balance).toBe(500);
  });

  it("AC2: loss case — outflow at lower rate than WAC produces signed-negative realized P&L", () => {
    // TWD wallet: WAC=0.034 balance=500, sell 500 at 0.032
    // realized = (0.032 - 0.034) × 500 = -1.00
    const prev: WalletState = { balance: 500, wacFxToUsd: 0.034, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -500, fxRateToUsd: 0.032 }));

    expect(next.balance).toBe(0);
    expect(next.realizedFxPnlLifetime).toBeCloseTo(-1.0, 2);
    expect(next.wacFxToUsd).toBeNull();  // balance hit 0 → WAC resets to null
  });

  it("balance reaches exactly 0 after outflow: WAC is reset to null", () => {
    // D9 / AC1 re-seed rule: WAC must be null when balance is 0
    const prev: WalletState = { balance: 300, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -300, fxRateToUsd: 0.032 }));

    expect(next.balance).toBe(0);
    expect(next.wacFxToUsd).toBeNull();
    expect(next.realizedFxPnlLifetime).toBe(0);  // break-even
  });

  it("partial outflow leaves WAC and remaining balance intact (AC3 second assertion)", () => {
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.032, realizedFxPnlLifetime: 3.0 };
    const next = applyEntryToWalletState(prev, entry({ amount: -200, fxRateToUsd: 0.036 }));

    // realized += (0.036 - 0.032) × 200 = 0.80
    expect(next.realizedFxPnlLifetime).toBeCloseTo(3.80, 2);
    expect(next.balance).toBe(800);
    expect(next.wacFxToUsd).toBe(0.032);  // WAC unchanged (AC3)
  });

  it("cumulative realized P&L accumulates across multiple sells (AC2)", () => {
    const prev: WalletState = { balance: 1000, wacFxToUsd: 0.030, realizedFxPnlLifetime: 0 };

    // Sell #1: 300 at 0.034 → (0.034-0.030)×300 = 1.20
    const s1 = applyEntryToWalletState(prev, entry({ amount: -300, fxRateToUsd: 0.034 }));
    expect(s1.realizedFxPnlLifetime).toBeCloseTo(1.20, 2);

    // Sell #2: 200 at 0.028 → (0.028-0.030)×200 = -0.40
    const s2 = applyEntryToWalletState(s1, entry({ amount: -200, fxRateToUsd: 0.028 }));
    expect(s2.realizedFxPnlLifetime).toBeCloseTo(0.80, 2);  // 1.20 + (-0.40)
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("applyEntryToWalletState — errors (D9)", () => {
  it("throws InsufficientWalletBalanceError when FX outflow exceeds balance", () => {
    // D9: insufficient balance on FX outflow
    const prev: WalletState = { balance: 100, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };

    expect(() =>
      applyEntryToWalletState(prev, entry({
        amount: -500,  // more than 100 available
        fxRateToUsd: 0.032,
        accountId: "acc-test",
        currency: "TWD",
        entryDate: "2026-03-15",
      })),
    ).toThrow(InsufficientWalletBalanceError);
  });

  it("InsufficientWalletBalanceError carries structured details (D9)", () => {
    const prev: WalletState = { balance: 100, wacFxToUsd: 0.032, realizedFxPnlLifetime: 0 };

    let caught: InsufficientWalletBalanceError | null = null;
    try {
      applyEntryToWalletState(prev, entry({
        amount: -500,
        fxRateToUsd: 0.032,
        accountId: "acc-structured",
        currency: "TWD",
        entryDate: "2026-03-15",
      }));
    } catch (err) {
      caught = err as InsufficientWalletBalanceError;
    }

    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(InsufficientWalletBalanceError);
    expect(caught!.details.available).toBe(100);
    expect(caught!.details.requested).toBe(500);
    expect(caught!.details.accountId).toBe("acc-structured");
    expect(caught!.details.currency).toBe("TWD");
    expect(caught!.details.entryDate).toBe("2026-03-15");
  });

  it("throws InsufficientWalletBalanceError on FX outflow before any inflow (WAC=null, balance=0) (D9)", () => {
    // Degenerate case: outflow with FX rate on a pristine wallet
    expect(() =>
      applyEntryToWalletState(emptyState(), entry({
        amount: -100,
        fxRateToUsd: 0.032,
        accountId: "acc-zero",
        currency: "TWD",
        entryDate: "2026-03-15",
      })),
    ).toThrow(InsufficientWalletBalanceError);
  });
});
