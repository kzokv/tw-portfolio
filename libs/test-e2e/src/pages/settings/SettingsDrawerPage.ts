import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TSettingsDrawerElements {
  drawer: Locator;
  tabs: {
    profile: Locator;
    general: Locator;
    fees: Locator;
    tickers: Locator;
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
  fees: {
    addProfileButton: Locator;
    profileCards: Locator;
    profileName: (index: number) => Locator;
    removeProfile: (index: number) => Locator;
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
      drawer: this.locate("settings-drawer", "Settings Drawer"),
      tabs: {
        profile: this.locate("settings-tab-profile", "Profile Tab"),
        general: this.locate("settings-tab-general", "General Tab"),
        fees: this.locate("settings-tab-fees", "Fees Tab"),
        tickers: this.locate("settings-tab-tickers", "Tickers Tab"),
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
