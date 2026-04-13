import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SourceCompositionTab } from "../../../components/dividends/SourceCompositionTab";
import { getDictionary } from "../../../lib/i18n";
import type { DividendSourceLine } from "@tw-portfolio/shared-types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildSourceLine(overrides: Partial<DividendSourceLine> & { sourceBucket: DividendSourceLine["sourceBucket"] }): DividendSourceLine {
  return {
    id: overrides.id ?? "sl-1",
    dividendLedgerEntryId: overrides.dividendLedgerEntryId ?? "ledger-1",
    sourceBucket: overrides.sourceBucket,
    amount: overrides.amount ?? 0,
    currencyCode: overrides.currencyCode ?? "TWD",
    source: overrides.source ?? "issuer_statement",
  };
}

describe("SourceCompositionTab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders bucket table with correct NHI subtotal in provided state", () => {
    const sourceLines: DividendSourceLine[] = [
      buildSourceLine({ id: "sl-1", sourceBucket: "DIVIDEND_INCOME", amount: 15_000 }),
      buildSourceLine({ id: "sl-2", sourceBucket: "INTEREST_INCOME", amount: 6_000 }),
      buildSourceLine({ id: "sl-3", sourceBucket: "CAPITAL_RETURN", amount: 2_000 }),
    ];

    act(() => {
      root.render(
        <SourceCompositionTab
          sourceLines={sourceLines}
          sourceCompositionStatus="provided"
          dict={dict}
          locale="en"
        />,
      );
    });

    const tab = document.querySelector("[data-testid='source-composition-tab']");
    expect(tab).not.toBeNull();

    // No estimate warning in provided state
    expect(document.querySelector("[data-testid='source-composition-estimate-warning']")).toBeNull();

    // NHI subtotal = DIVIDEND_INCOME (15_000) + INTEREST_INCOME (6_000) = 21_000
    const subtotal = document.querySelector("[data-testid='source-composition-nhi-subtotal']");
    expect(subtotal).not.toBeNull();
    expect(subtotal?.textContent).toMatch(/21,000|21000/);

    // Bucket rows rendered (3 buckets with amounts > 0)
    const rows = tab!.querySelectorAll("tbody tr");
    // 3 bucket rows + NHI subtotal row + projected premium row = 5
    expect(rows.length).toBe(5);

    // NHI subject indicators
    expect(tab!.textContent).toContain("Dividend income");
    expect(tab!.textContent).toContain("Interest income");
    expect(tab!.textContent).toContain("Capital return");
  });

  it("renders estimate warning and zero amounts in unknown_pending_disclosure state", () => {
    act(() => {
      root.render(
        <SourceCompositionTab
          sourceLines={[]}
          sourceCompositionStatus="unknown_pending_disclosure"
          dict={dict}
          locale="en"
        />,
      );
    });

    const warning = document.querySelector("[data-testid='source-composition-estimate-warning']");
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("Estimated NT$0");

    // All 7 bucket types should be visible in estimate state
    const tab = document.querySelector("[data-testid='source-composition-tab']");
    expect(tab).not.toBeNull();
    const rows = tab!.querySelectorAll("tbody tr");
    // 7 bucket rows + NHI subtotal row + projected premium row = 9
    expect(rows.length).toBe(9);

    // NHI subtotal should be 0
    const subtotal = document.querySelector("[data-testid='source-composition-nhi-subtotal']");
    expect(subtotal?.textContent).toMatch(/\$0|NT\$0/);
  });

  it("computes projected premium only when NHI-subject subtotal >= NT$20,000", () => {
    // Below threshold: NHI-subject sum = 19_000
    const belowThreshold: DividendSourceLine[] = [
      buildSourceLine({ id: "sl-1", sourceBucket: "DIVIDEND_INCOME", amount: 19_000 }),
    ];

    act(() => {
      root.render(
        <SourceCompositionTab
          sourceLines={belowThreshold}
          sourceCompositionStatus="provided"
          dict={dict}
          locale="en"
        />,
      );
    });

    // Projected premium should be 0 when below threshold
    const tab = document.querySelector("[data-testid='source-composition-tab']");
    const premiumRow = tab!.querySelectorAll("tbody tr");
    // Last row is projected premium
    const lastRow = premiumRow[premiumRow.length - 1];
    // Should show NT$0 for premium
    expect(lastRow?.textContent).toMatch(/\$0|NT\$0/);
  });

  it("computes projected premium at 2.11% when NHI-subject subtotal >= NT$20,000", () => {
    const aboveThreshold: DividendSourceLine[] = [
      buildSourceLine({ id: "sl-1", sourceBucket: "DIVIDEND_INCOME", amount: 25_000 }),
    ];

    act(() => {
      root.render(
        <SourceCompositionTab
          sourceLines={aboveThreshold}
          sourceCompositionStatus="provided"
          dict={dict}
          locale="en"
        />,
      );
    });

    // Premium = 25_000 × 0.0211 = 527.5 → rounds to 528
    const tab = document.querySelector("[data-testid='source-composition-tab']");
    const rows = tab!.querySelectorAll("tbody tr");
    const premiumRow = rows[rows.length - 1];
    expect(premiumRow?.textContent).toMatch(/528/);
  });
});
