import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

export interface TSettingsDrawerElements extends TElementLocatorHelpers {
  drawer: Locator;
  tabs: {
    profile: Locator;
    general: Locator;
    fees: Locator;
    accounts: Locator;
    tickers: Locator;
  };
  accountCreate: {
    form: Locator;
    nameInput: Locator;
    typePill: (type: "broker" | "bank" | "wallet") => Locator;
    currencyCard: (currency: "TWD" | "USD" | "AUD") => Locator;
    feeProfileSelect: Locator;
    previewChip: Locator;
    submit: Locator;
    error: Locator;
  };
  general: {
    localeSelect: Locator;
    costBasisSelect: Locator;
    quotePollInput: Locator;
    localeTooltipTrigger: Locator;
    localeTooltipContent: Locator;
    costBasisTooltipTrigger: Locator;
    costBasisTooltipContent: Locator;
  };
  unsavedChangesDialog: {
    cancel: Locator;
    keepEditing: Locator;
  };
  fees: {
    addProfileButton: Locator;
    profileCards: Locator;
    profileName: (index: number) => Locator;
    removeProfile: (index: number) => Locator;
    addBindingButton: Locator;
    bindingRow: (index: number) => Locator;
    bindingAccountSelect: (index: number) => Locator;
    bindingAccountOption: (index: number, accountId: string) => Locator;
  };
  accountsList: {
    accountProfileSelect: (accountId: string) => Locator;
  };
  profile: {
    section: Locator;
    displayNameInput: Locator;
    emailInput: Locator;
    saveEmailButton: Locator;
    emailSavedIndicator: Locator;
  };
  tickers: {
    section: Locator;
    search: Locator;
    emptyState: Locator;
    browseCatalogButton: Locator;
    saveButton: Locator;
    savedMessage: Locator;
    positionTicker: (ticker: string) => Locator;
    manualTicker: (ticker: string) => Locator;
    backfillBadge: (ticker: string) => Locator;
    retryBackfillButton: (ticker: string) => Locator;
    repairModeButton: Locator;
    repairCancelButton: Locator;
    repairContinueButton: Locator;
    repairCheckboxRow: (ticker: string) => Locator;
    repairSelection: (ticker: string) => Locator;
    repairCooldownHint: (ticker: string) => Locator;
  };
  repairModal: {
    dialog: Locator;
    startDateInput: Locator;
    endDateInput: Locator;
    includeBarsCheckbox: Locator;
    includeDividendsCheckbox: Locator;
    applyAllToggle: Locator;
    perTickerToggle: Locator;
    submitButton: Locator;
  };
  catalog: {
    sheet: Locator;
    backButton: Locator;
    search: Locator;
    list: Locator;
    filterAll: Locator;
    filterStock: Locator;
    filterEtf: Locator;
    filterBondEtf: Locator;
    item: (ticker: string) => Locator;
    itemCheckbox: (ticker: string) => Locator;
  };
  footer: {
    saveButton: Locator;
    discardButton: Locator;
    validationError: Locator;
    closeWarning: Locator;
    discardNotice: Locator;
  };
}

export class SettingsDrawerPage extends BasePage<TSettingsDrawerElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      drawer: this.locate("settings-drawer", "Settings Drawer"),
      tabs: {
        profile: this.locate("settings-tab-profile", "Profile Tab"),
        general: this.locate("settings-tab-general", "General Tab"),
        fees: this.locate("settings-tab-fees", "Fees Tab"),
        accounts: this.locate("settings-tab-accounts", "Accounts Tab"),
        tickers: this.locate("settings-tab-tickers", "Tickers Tab"),
      },
      accountCreate: {
        form: this.locate("account-create-form", "Account Create Form"),
        nameInput: this.locate("account-create-name-input", "Account Create Name Input"),
        typePill: (type: "broker" | "bank" | "wallet") =>
          this.locate(`account-create-type-${type}`, `Account Create Type Pill (${type})`),
        currencyCard: (currency: "TWD" | "USD" | "AUD") =>
          this.locate(
            `account-create-currency-${currency}`,
            `Account Create Currency Card (${currency})`,
          ),
        feeProfileSelect: this.locate(
          "account-create-fee-profile-select",
          "Account Create Fee Profile Select",
        ),
        previewChip: this.locate(
          "account-create-preview-chip",
          "Account Create Preview Chip",
        ),
        submit: this.locate("account-create-submit", "Account Create Submit"),
        error: this.locate("account-create-error", "Account Create Inline Error"),
      },
      general: {
        localeSelect: this.locate("settings-locale-select", "Locale Select"),
        costBasisSelect: this.locate("settings-cost-basis-select", "Cost Basis Method Select"),
        quotePollInput: this.locate("settings-quote-poll-input", "Quote Poll Interval Input"),
        localeTooltipTrigger: this.locate("tooltip-settings-locale-trigger", "Locale Tooltip Trigger"),
        localeTooltipContent: this.locate("tooltip-settings-locale-content", "Locale Tooltip Content"),
        costBasisTooltipTrigger: this.locate("tooltip-settings-cost-basis-trigger", "Cost Basis Tooltip Trigger"),
        costBasisTooltipContent: this.locate("tooltip-settings-cost-basis-content", "Cost Basis Tooltip Content"),
      },
      unsavedChangesDialog: {
        cancel: this.locateByRole("button", {
          name: /Cancel|取消/,
          description: "Unsaved Changes Cancel Button",
        }),
        keepEditing: this.locateByRole("button", {
          name: /Keep Editing|繼續編輯/,
          description: "Unsaved Changes Keep Editing Button",
        }),
      },
      fees: {
        addProfileButton: this.locate("settings-add-profile-button", "Add Fee Profile Button"),
        profileCards: this.withDescription(
          this.page.locator('[data-testid^="settings-profile-name-"]'),
          "Fee Profile Name Fields",
        ),
        profileName: (index: number) =>
          this.locate(`settings-profile-name-${index}`, `Fee Profile Name ${index}`),
        removeProfile: (index: number) =>
          this.locate(`settings-remove-profile-${index}`, `Remove Fee Profile ${index}`),
        addBindingButton: this.locate("settings-add-binding-button", "Add Override Button"),
        bindingRow: (index: number) =>
          this.locate(`settings-binding-row-${index}`, `Binding Row ${index}`),
        bindingAccountSelect: (index: number) =>
          this.locate(
            `settings-binding-account-${index}`,
            `Binding Account Select ${index}`,
          ),
        bindingAccountOption: (index: number, accountId: string) =>
          this.withinByCss(
            this.locate(`settings-binding-account-${index}`),
            `option[value="${accountId}"]`,
            `Binding ${index} Option (${accountId})`,
          ),
      },
      accountsList: {
        accountProfileSelect: (accountId: string) =>
          this.locate(
            `settings-account-profile-${accountId}`,
            `Account Profile Select (${accountId})`,
          ),
      },
      profile: {
        section: this.locate("profile-section", "Profile Section"),
        displayNameInput: this.locate("profile-display-name-input", "Profile Display Name Input"),
        emailInput: this.locate("profile-email-input", "Profile Email Input"),
        saveEmailButton: this.locate("profile-save-email", "Profile Save Email Button"),
        emailSavedIndicator: this.locate("profile-email-saved", "Profile Email Saved Indicator"),
      },
      tickers: {
        section: this.locate("monitored-tickers-section", "Monitored Tickers Section"),
        search: this.locate("tickers-search", "Tickers Search Input"),
        emptyState: this.withDescription(
          this.page.getByText("No tickers selected"),
          "Tickers Empty State",
        ),
        browseCatalogButton: this.locate("browse-catalog-btn", "Browse Full Catalog Button"),
        saveButton: this.locate("tickers-save-btn", "Tickers Save Button"),
        savedMessage: this.withDescription(
          this.page.getByText("Selections saved"),
          "Tickers Saved Message",
        ),
        positionTicker: (ticker: string) =>
          this.locate(`position-ticker-${ticker}`, `Position Ticker ${ticker}`),
        manualTicker: (ticker: string) =>
          this.locate(`manual-ticker-${ticker}`, `Manual Ticker ${ticker}`),
        backfillBadge: (ticker: string) =>
          this.locate(`backfill-badge-${ticker}`, `Backfill Badge ${ticker}`),
        retryBackfillButton: (ticker: string) =>
          this.locate(`retry-backfill-${ticker}`, `Retry Backfill Button ${ticker}`),
        repairModeButton: this.withDescription(
          this.page.getByTestId("repair-mode-toggle-btn"),
          "Repair Mode Button",
        ),
        repairCancelButton: this.withDescription(
          this.page.getByTestId("repair-cancel-btn"),
          "Repair Cancel Button",
        ),
        repairContinueButton: this.withDescription(
          this.page.getByTestId("repair-continue-btn"),
          "Repair Continue Button",
        ),
        repairCheckboxRow: (ticker: string) =>
          this.withDescription(
            this.page.getByTestId(`repair-row-${ticker}`),
            `Repair Checkbox Row ${ticker}`,
          ),
        repairSelection: (ticker: string) =>
          this.locate(`repair-selection-${ticker}`, `Repair Selection ${ticker}`),
        repairCooldownHint: (ticker: string) =>
          this.withDescription(
            this.page.getByTestId(`repair-cooldown-hint-${ticker}`),
            `Repair Cooldown Hint ${ticker}`,
          ),
      },
      repairModal: {
        dialog: this.withDescription(
          this.page.getByTestId("repair-modal"),
          "Repair Modal",
        ),
        startDateInput: this.withDescription(
          this.page.getByTestId("repair-start-date"),
          "Repair Start Date Input",
        ),
        endDateInput: this.withDescription(
          this.page.getByTestId("repair-end-date"),
          "Repair End Date Input",
        ),
        includeBarsCheckbox: this.withDescription(
          this.page.getByTestId("repair-include-bars"),
          "Repair Include Bars Checkbox",
        ),
        includeDividendsCheckbox: this.withDescription(
          this.page.getByTestId("repair-include-dividends"),
          "Repair Include Dividends Checkbox",
        ),
        applyAllToggle: this.withDescription(
          this.page.getByTestId("repair-apply-all"),
          "Repair Apply-All Toggle",
        ),
        perTickerToggle: this.withDescription(
          this.page.getByTestId("repair-per-ticker"),
          "Repair Per-Ticker Toggle",
        ),
        submitButton: this.withDescription(
          this.page.getByTestId("repair-submit"),
          "Repair Submit Button",
        ),
      },
      catalog: {
        sheet: this.locate("instrument-catalog-sheet", "Instrument Catalog Sheet"),
        backButton: this.locate("catalog-back-btn", "Catalog Back Button"),
        search: this.locate("catalog-search", "Catalog Search Input"),
        list: this.locate("catalog-list", "Catalog List"),
        filterAll: this.locate("catalog-filter-all", "Catalog Filter All"),
        filterStock: this.locate("catalog-filter-stock", "Catalog Filter Stock"),
        filterEtf: this.locate("catalog-filter-etf", "Catalog Filter ETF"),
        filterBondEtf: this.locate("catalog-filter-bond_etf", "Catalog Filter Bond ETF"),
        item: (ticker: string) =>
          this.locate(`catalog-item-${ticker}`, `Catalog Item ${ticker}`),
        itemCheckbox: (ticker: string) =>
          this.withinByCss(
            this.locate(`catalog-item-${ticker}`),
            "input[type=checkbox]",
            `Catalog Item Checkbox ${ticker}`,
          ),
      },
      footer: {
        saveButton: this.locate("settings-save-button", "Save Settings Button"),
        discardButton: this.locate("settings-discard-button", "Discard Settings Button"),
        validationError: this.locate("settings-validation-error", "Settings Validation Error"),
        closeWarning: this.locate("settings-close-warning", "Unsaved Changes Warning"),
        discardNotice: this.locate("settings-discard-notice", "Discard Settings Notice"),
      },
    };
  }
}
