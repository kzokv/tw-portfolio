import type { Locator } from "@playwright/test";
import type { MarketCode } from "@vakwen/shared-types";
import { BasePage } from "@vakwen/test-framework/core";

/** Shared form used on both TransactionsPage and TickerDetailPage record dialog. */
type TransactionFormMarket = MarketCode | "ALL";

export interface TTransactionFormElements {
  recordTransactionButton: Locator;
  recordTransactionDialog: Locator;
  addTransactionDialog: Locator;
  tickerCombobox: Locator;
  tickerListbox: Locator;
  tickerEmptyState: Locator;
  tickerMatchCount: Locator;
  marketChip: (market: TransactionFormMarket) => Locator;
  tickerOption: (ticker: string, marketCode?: MarketCode) => Locator;
  accountSelector: Locator;
  accountSelect: Locator;
  accountOption: (index: number) => Locator;
  accountOptionByText: (text: string | RegExp) => Locator;
  selectedAccountOption: Locator;
  noAccountError: Locator;
  createAccountLink: Locator;
  typeSelect: Locator;
  quantityInput: Locator;
  priceInput: Locator;
  unitPriceInput: Locator;
  priceCurrencyInput: Locator;
  priceSourceHint: Locator;
  priceUnavailableHint: Locator;
  tradeDateInput: Locator;
  commissionEstimateSection: Locator;
  commissionEstimateValue: Locator;
  commissionEstimateUnavailable: Locator;
  commissionOverrideInput: Locator;
  taxEstimateSection: Locator;
  taxEstimateValue: Locator;
  taxEstimateUnavailable: Locator;
  taxOverrideInput: Locator;
  sellAvailabilityPanel: Locator;
  sellAvailabilityLoading: Locator;
  sellAvailabilityReady: Locator;
  sellAvailabilityUseMax: Locator;
  sellAvailabilityTransportWarning: Locator;
  sellAvailabilityUnavailable: Locator;
  sellAvailabilityOversell: Locator;
  submitButton: Locator;
}

export class TransactionFormComponent extends BasePage<TTransactionFormElements> {
  protected initializeElements(): void {
    const accountSelect = this.locate("tx-account-select", "Account Select");
    const unitPriceInput = this.withDescription(
      this.page.locator('[data-testid="unit-price-input"], [data-testid="tx-price-input"]'),
      "Unit Price Input",
    );

    this._elements = {
      recordTransactionButton: this.locate("record-transaction-button", "Record Transaction Button"),
      recordTransactionDialog: this.locate("record-transaction-dialog", "Record Transaction Dialog"),
      addTransactionDialog: this.locate("add-transaction-dialog", "Global Add Transaction Dialog"),
      tickerCombobox: this.locate("tx-ticker-combobox", "Ticker Combobox"),
      tickerListbox: this.locate("tx-ticker-listbox", "Ticker Listbox"),
      tickerEmptyState: this.locate("tx-ticker-empty-state", "Ticker Empty State"),
      tickerMatchCount: this.locate("tx-ticker-match-count", "Ticker Match Count"),
      marketChip: (market: TransactionFormMarket) =>
        this.locate(`tx-market-chip-${market}`, `Market Chip ${market}`),
      tickerOption: (ticker: string, marketCode?: MarketCode) =>
        marketCode
          ? this.locate(`tx-ticker-option-${ticker}-${marketCode}`, `Ticker Option ${ticker} ${marketCode}`)
          : this.withDescription(
            this.scope.locator(`[data-testid^="tx-ticker-option-${ticker}-"]`).first(),
            `Ticker Option ${ticker}`,
          ),
      accountSelector: this.locate("account-selector", "Account Selector"),
      accountSelect,
      accountOption: (index: number) =>
        this.withDescription(accountSelect.locator("option").nth(index), `Account Option ${index}`),
      accountOptionByText: (text: string | RegExp) =>
        this.withDescription(accountSelect.locator("option").filter({ hasText: text }), "Account Option By Text"),
      selectedAccountOption: this.withDescription(accountSelect.locator("option:checked"), "Selected Account Option"),
      noAccountError: this.locate("tx-no-account-error", "No Account Error"),
      createAccountLink: this.locate("tx-create-account-link", "Create Account Link"),
      typeSelect: this.locate("tx-type-select", "Transaction Type Select"),
      quantityInput: this.locate("tx-quantity-input", "Quantity Input"),
      priceInput: unitPriceInput,
      unitPriceInput,
      priceCurrencyInput: this.locate("tx-price-currency-input", "Price Currency Input"),
      priceSourceHint: this.locate("price-source-hint", "Price Source Hint"),
      priceUnavailableHint: this.locate("price-unavailable-hint", "Price Unavailable Hint"),
      tradeDateInput: this.locate("tx-trade-date-input", "Trade Date Input"),
      commissionEstimateSection: this.locate("commission-estimate-section", "Commission Estimate Section"),
      commissionEstimateValue: this.locate("commission-estimate-value", "Commission Estimate Value"),
      commissionEstimateUnavailable: this.locate(
        "commission-estimate-unavailable",
        "Commission Estimate Unavailable",
      ),
      commissionOverrideInput: this.locate("commission-override-input", "Commission Override Input"),
      taxEstimateSection: this.locate("tax-estimate-section", "Tax Estimate Section"),
      taxEstimateValue: this.locate("tax-estimate-value", "Tax Estimate Value"),
      taxEstimateUnavailable: this.locate("tax-estimate-unavailable", "Tax Estimate Unavailable"),
      taxOverrideInput: this.locate("tax-override-input", "Tax Override Input"),
      sellAvailabilityPanel: this.locate("sell-availability-panel", "Sell Availability Panel"),
      sellAvailabilityLoading: this.locate("sell-availability-loading", "Sell Availability Loading State"),
      sellAvailabilityReady: this.locate("sell-availability-ready", "Sell Availability Ready State"),
      sellAvailabilityUseMax: this.locate("sell-availability-use-max", "Sell Availability Use Max Button"),
      sellAvailabilityTransportWarning: this.locate(
        "sell-availability-transport-warning",
        "Sell Availability Transport Warning",
      ),
      sellAvailabilityUnavailable: this.locate("sell-availability-unavailable", "Sell Availability Unavailable State"),
      sellAvailabilityOversell: this.locate("sell-availability-oversell", "Sell Availability Oversell Error"),
      submitButton: this.locate("tx-submit-button", "Submit Button"),
    };
  }
}
