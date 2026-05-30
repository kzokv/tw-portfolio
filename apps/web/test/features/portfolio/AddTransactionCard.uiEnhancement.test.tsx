/**
 * ui-enhancement (Items 2, 3, 4) — Web unit tests for AddTransactionCard.
 *
 * Three behavioral changes asserted here. Existing tests in
 * `AddTransactionCard.test.tsx` retain their KZO-169 baseline; the
 * Frontend Implementer updates THOSE existing assertions (e.g., the
 * "renders all four chip pills (TW / US / AU / All)" test and the
 * deriveDefaultMarketChip-returns-null tests) per
 * `implementer-qa-test-ownership.md`.
 *
 * NEW behavioral assertions:
 *  - tx-market-chip-ALL never renders (Item 4)
 *  - MARKET_CHIPS renders the supported concrete market codes (Item 4)
 *  - deriveDefaultMarketChip returns first-account market for multi-currency
 *    AND "TW" for empty (Item 4, scope item 21)
 *  - Fee/Tax estimate section render gate uses 4-tuple, not feeEstimate (Items 2/3)
 *  - When 4-tuple holds but feeEstimate is null, the section still renders
 *    with "estimate unavailable" degradation copy (Item 2, scope item 15)
 *  - Override input is always present + editable inside the rendered section
 *    (Item 3, scope item 16)
 *  - Tax section gated by `value.type === "SELL"` (Item 3, scope item 19)
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AddTransactionCard,
  deriveDefaultMarketChip,
  type TransactionAccountOption,
} from "../../../components/portfolio/AddTransactionCard";
import { getDictionary } from "../../../lib/i18n";
import type { TransactionInput } from "../../../components/portfolio/types";

const dict = getDictionary("en");

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const TWD_ACCOUNT: TransactionAccountOption = {
  id: "acc-tw",
  name: "Yuanta",
  feeProfileName: "Default Broker",
  defaultCurrency: "TWD",
  accountType: "broker",
};
const USD_ACCOUNT: TransactionAccountOption = {
  id: "acc-us",
  name: "Schwab",
  feeProfileName: "US Broker",
  defaultCurrency: "USD",
  accountType: "broker",
};
const AUD_ACCOUNT: TransactionAccountOption = {
  id: "acc-au",
  name: "CommSec",
  feeProfileName: "AU Broker",
  defaultCurrency: "AUD",
  accountType: "broker",
};
const KRW_ACCOUNT: TransactionAccountOption = {
  id: "acc-kr",
  name: "KR Broker",
  feeProfileName: "KR Broker",
  defaultCurrency: "KRW",
  accountType: "broker",
};

function valueWith(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    accountId: "",
    ticker: "",
    marketCode: null,
    quantity: 0,
    unitPrice: 0,
    priceCurrency: "TWD",
    tradeDate: "2026-05-13",
    type: "BUY",
    isDayTrade: false,
    ...overrides,
  };
}

describe("ui-enhancement — deriveDefaultMarketChip (scope item 21)", () => {
  it("returns first-account market when accounts share currency (TW)", () => {
    expect(deriveDefaultMarketChip([TWD_ACCOUNT, { ...TWD_ACCOUNT, id: "acc-tw-2" }])).toBe("TW");
  });

  it("returns first-account market for multi-currency users (not null)", () => {
    expect(deriveDefaultMarketChip([USD_ACCOUNT, TWD_ACCOUNT, AUD_ACCOUNT])).toBe("US");
    expect(deriveDefaultMarketChip([AUD_ACCOUNT, TWD_ACCOUNT])).toBe("AU");
    expect(deriveDefaultMarketChip([KRW_ACCOUNT, TWD_ACCOUNT])).toBe("KR");
  });

  it("returns 'TW' fallback when accounts list is empty", () => {
    expect(deriveDefaultMarketChip([])).toBe("TW");
  });
});

describe("ui-enhancement — Market chip rendering (Item 4)", () => {
  it("does NOT render data-testid='tx-market-chip-ALL'", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ accountId: "acc-tw", marketCode: "TW" })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).not.toContain('data-testid="tx-market-chip-ALL"');
    // All concrete market chips still render.
    expect(html).toContain('data-testid="tx-market-chip-TW"');
    expect(html).toContain('data-testid="tx-market-chip-US"');
    expect(html).toContain('data-testid="tx-market-chip-AU"');
    expect(html).toContain('data-testid="tx-market-chip-KR"');
  });
});

describe("ui-enhancement — Fee/Tax 4-tuple render gate (Items 2, 3)", () => {
  it("renders commission-estimate-section when accountId + ticker + qty>0 + price>0 (BUY)", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).toContain('data-testid="commission-estimate-section"');
  });

  it("does NOT render commission-estimate-section when 4-tuple incomplete (no ticker)", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).not.toContain('data-testid="commission-estimate-section"');
  });

  it("does NOT render commission-estimate-section when quantity is 0", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 0,
          unitPrice: 100,
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).not.toContain('data-testid="commission-estimate-section"');
  });

  it("does NOT render commission-estimate-section when unitPrice is 0", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 0,
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).not.toContain('data-testid="commission-estimate-section"');
  });

  it("renders the section with 'estimate unavailable' degradation when 4-tuple holds but feeEstimate=null", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).toContain('data-testid="commission-estimate-section"');
    expect(html).toContain('data-testid="commission-estimate-unavailable"');
    // Override input is present + editable per scope item 16.
    expect(html).toContain('data-testid="commission-override-input"');
  });

  it("tax-estimate-section appears for SELL (per scope item 19) and not for BUY", () => {
    const sellHtml = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
          type: "SELL",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(sellHtml).toContain('data-testid="tax-estimate-section"');

    const buyHtml = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
          type: "BUY",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(buyHtml).not.toContain('data-testid="tax-estimate-section"');
  });
});

describe("ui-enhancement — Live-DOM chip + ticker clear on market change (Item 4, scope item 23)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("changing market chip filters accounts and clears the committed ticker", () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    let latest: TransactionInput = valueWith({
      accountId: "acc-tw",
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
    });

    function Harness() {
      const [value, setValue] = React.useState<TransactionInput>(latest);
      latest = value;
      return (
        <AddTransactionCard
          value={value}
          accountOptions={[TWD_ACCOUNT, USD_ACCOUNT]}
          pending={false}
          onChange={(next) => setValue(next as TransactionInput)}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />
      );
    }

    act(() => {
      root = createRoot(container!);
      root.render(<Harness />);
    });

    const initialSelect = container.querySelector(
      '[data-testid="tx-account-select"]',
    ) as HTMLSelectElement | null;
    if (!initialSelect) {
      throw new Error("Expected tx-account-select to be present for an active account");
    }
    expect(Array.from(initialSelect.options).map((option) => option.value)).toEqual([
      "acc-tw",
    ]);

    const usChip = container.querySelector(
      '[data-testid="tx-market-chip-US"]',
    ) as HTMLButtonElement | null;
    if (!usChip) {
      throw new Error("Expected tx-market-chip-US to be present");
    }
    act(() => {
      usChip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nextSelect = container.querySelector(
      '[data-testid="tx-account-select"]',
    ) as HTMLSelectElement | null;
    if (!nextSelect) {
      throw new Error("Expected tx-account-select to remain present for the USD account");
    }
    expect(Array.from(nextSelect.options).map((option) => option.value)).toEqual([
      "acc-us",
    ]);
    expect(latest.accountId).toBe("acc-us");
    expect(latest.marketCode).toBe("US");
    expect(latest.ticker).toBe("");
    expect(latest.priceCurrency).toBe("USD");
  });
});
