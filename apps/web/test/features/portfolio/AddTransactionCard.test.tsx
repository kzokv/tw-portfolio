import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AddTransactionCard,
  buildCreateAccountHref,
  deriveDefaultMarketChip,
  filterAccountsByDerivedCurrency,
  type TransactionAccountOption,
} from "../../../components/portfolio/AddTransactionCard";
import { getDictionary } from "../../../lib/i18n";
import type { TransactionInput } from "../../../components/portfolio/types";

const dict = getDictionary("en");

// KZO-169 — Frontend Implementer's TDD red specs for slice 5 / 6 / 7. These
// tests assert the chip-default derivation, account-filter logic, inline
// no-account-error rendering, and the create-account deep-link href.
//
// Companion files exercised:
//  - apps/web/components/portfolio/AddTransactionCard.tsx (derive helpers)
//  - apps/web/components/portfolio/InstrumentCombobox.tsx (ALL-mode suffix)

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

describe("deriveDefaultMarketChip — ui-enhancement (2026-05-13)", () => {
  // ui-enhancement scope items 20–22: ALL chip removed from the Record
  // Transaction surface. Default chip is now the FIRST account's market
  // (replaces only-currency-or-null semantics). Empty list → "TW" fallback.

  it("returns the matching MarketCode when all accounts share one currency (TW-only user)", () => {
    expect(deriveDefaultMarketChip([TWD_ACCOUNT, { ...TWD_ACCOUNT, id: "acc-tw-2" }])).toBe("TW");
  });

  it("returns 'US' when all accounts share USD", () => {
    expect(deriveDefaultMarketChip([USD_ACCOUNT])).toBe("US");
  });

  it("returns 'AU' when all accounts share AUD", () => {
    expect(deriveDefaultMarketChip([AUD_ACCOUNT])).toBe("AU");
  });

  it("returns the FIRST account's market for multi-currency users", () => {
    expect(deriveDefaultMarketChip([TWD_ACCOUNT, USD_ACCOUNT])).toBe("TW");
    expect(deriveDefaultMarketChip([USD_ACCOUNT, TWD_ACCOUNT, AUD_ACCOUNT])).toBe("US");
  });

  it("returns 'TW' when accounts list is empty (defensive fallback per scope item 21)", () => {
    expect(deriveDefaultMarketChip([])).toBe("TW");
  });
});

describe("filterAccountsByDerivedCurrency — KZO-169 D8b", () => {
  it("returns the full list when derived currency is null (no commit yet)", () => {
    const accounts = [TWD_ACCOUNT, USD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, null).map((a) => a.id)).toEqual([
      "acc-tw",
      "acc-us",
    ]);
  });

  it("filters to TWD accounts when derived currency = TWD", () => {
    const accounts = [TWD_ACCOUNT, USD_ACCOUNT, AUD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, "TWD").map((a) => a.id)).toEqual([
      "acc-tw",
    ]);
  });

  it("returns empty array when no account matches the derived currency (D8c trigger)", () => {
    const accounts = [TWD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, "USD")).toEqual([]);
  });
});

describe("buildCreateAccountHref — KZO-169 NC4 deep-link", () => {
  it("encodes drawer + tab + currency params for the no-account inline error link", () => {
    expect(buildCreateAccountHref("/dashboard", "USD")).toBe(
      "/dashboard?drawer=settings&settingsTab=accounts&accountsPrefillCurrency=USD",
    );
    expect(buildCreateAccountHref("/transactions", "AUD")).toBe(
      "/transactions?drawer=settings&settingsTab=accounts&accountsPrefillCurrency=AUD",
    );
  });
});

describe("AddTransactionCard — chip + account-filter render contract", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  function valueWith(overrides: Partial<TransactionInput> = {}): TransactionInput {
    return {
      accountId: "",
      ticker: "",
      marketCode: null,
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-04-30",
      type: "BUY",
      isDayTrade: false,
      ...overrides,
    };
  }

  it("renders the three market chip pills (TW / US / AU) without the removed ALL chip", () => {
    // ui-enhancement (2026-05-13) — ALL chip removed from this surface.
    // Settings → Tickers catalog browser keeps ALL.
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
    expect(html).toContain('data-testid="tx-market-chip-TW"');
    expect(html).toContain('data-testid="tx-market-chip-US"');
    expect(html).toContain('data-testid="tx-market-chip-AU"');
    expect(html).not.toContain('data-testid="tx-market-chip-ALL"');
  });

  it("renders the inline no-account error block ONLY in the zero-account state (ui-enhancement)", () => {
    // ui-enhancement (2026-05-13): the `account → chip` one-way binding
    // removes the chip → account filter. The error block now triggers
    // only when the user has zero accounts at all.
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: null })}
        accountOptions={[]}
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
    expect(html).toContain('data-testid="tx-no-account-error"');
    expect(html).toContain('data-testid="tx-create-account-link"');
    // Account dropdown is NOT rendered in this state — replaced by the error block.
    expect(html).not.toContain('data-testid="tx-account-select"');
  });

  it("shows the account dropdown with ALL accounts regardless of chip (ui-enhancement)", () => {
    // ui-enhancement: dropdown lists every account; chip auto-syncs to the
    // selected account. Replaces the previous chip → account filter.
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: "US" })}
        accountOptions={[TWD_ACCOUNT, USD_ACCOUNT, AUD_ACCOUNT]}
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
    expect(html).toContain('data-testid="tx-account-select"');
    expect(html).toContain('value="acc-tw"');
    expect(html).toContain('value="acc-us"');
    expect(html).toContain('value="acc-au"');
    expect(html).not.toContain('data-testid="tx-no-account-error"');
  });

  it("does NOT render the no-account error when the chip matches an existing account currency", () => {
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
    expect(html).not.toContain('data-testid="tx-no-account-error"');
    expect(html).toContain('data-testid="tx-account-select"');
  });

  it("disables submit when chip + ticker not committed", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddTransactionCard
          value={valueWith({ accountId: "acc-tw", ticker: "", marketCode: null })}
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
    });
    const submitButton = container.querySelector('[data-testid="tx-submit-button"]') as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(true);
  });

  it("enables submit when account + ticker + marketCode are all set with a compatible account", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddTransactionCard
          value={valueWith({ accountId: "acc-tw", ticker: "2330", marketCode: "TW" })}
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
    });
    const submitButton = container.querySelector('[data-testid="tx-submit-button"]') as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(false);
  });
});
