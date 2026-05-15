import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TSettingsDrawerElements extends TElementLocatorHelpers {
  drawer: Locator;
  tabs: {
    profile: Locator;
    general: Locator;
    accounts: Locator;
    tickers: Locator;
  };
  accountCreate: {
    form: Locator;
    nameInput: Locator;
    typePill: (type: "broker" | "bank" | "wallet") => Locator;
    currencyCard: (currency: "TWD" | "USD" | "AUD") => Locator;
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
  // KZO-183: per-account expandable cards. The legacy `fees` section
  // (FeeProfilesSection + SecurityBindingsSection) was deleted; profile
  // CRUD + per-symbol overrides now live inline within each account card.
  accountsList: {
    searchInput: Locator;
    card: (accountId: string) => Locator;
    cardToggle: (accountId: string) => Locator;
    marketBadge: (accountId: string) => Locator;
    accountProfileSelect: (accountId: string) => Locator;
    addProfile: (accountId: string) => Locator;
    duplicateCta: (accountId: string) => Locator;
    addOverride: (accountId: string) => Locator;
    duplicatePicker: Locator;
    duplicateSourceSelect: Locator;
    duplicateConfirm: Locator;
    duplicateCancel: Locator;
    duplicateCheckbox: (profileId: string) => Locator;
    profileRows: (accountId: string) => Locator;
    profileRow: (accountId: string, profileId: string) => Locator;
    profileEditButton: (profileId: string) => Locator;
    profileNameInput: (profileId: string) => Locator;
    profileEditDoneButton: (profileId: string) => Locator;
    // ui-enhancement — Item 1: per-account Delete button + modals + recently-deleted.
    deleteButton: (accountId: string) => Locator;
    softDeleteModal: Locator;
    softDeleteConfirmButton: Locator;
    softDeleteCancelButton: Locator;
    softDeleteWarningOpenPositions: Locator;
    softDeleteWarningCashBalance: Locator;
    softDeleteWarningLastAccount: Locator;
    permanentDeleteModal: Locator;
    permanentDeleteInput: Locator;
    permanentDeleteConfirmButton: Locator;
    permanentDeleteCancelButton: Locator;
    recentlyDeletedSection: Locator;
    recentlyDeletedHeader: Locator;
    recentlyDeletedRow: (accountId: string) => Locator;
    recentlyDeletedRestoreButton: (accountId: string) => Locator;
    recentlyDeletedPurgeButton: (accountId: string) => Locator;
    recentlyDeletedTimeRemaining: (accountId: string) => Locator;
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
    // KZO-194: all currently-rendered catalog-item-* rows (for count assertions)
    allItems: Locator;
    itemCheckbox: (ticker: string) => Locator;
    // KZO-188: market chip group (All · TW · US · AU) above type-filter chips
    marketChip: (market: "all" | "TW" | "US" | "AU") => Locator;
    // KZO-188: LIVE badge text rendered inside a live-sourced catalog row
    liveItemBadge: (ticker: string) => Locator;
    // KZO-188: live-search error message rendered when search backend is degraded
    liveUnavailableMessage: Locator;
    // KZO-188: in-flight live-search indicator
    liveSearchingMessage: Locator;
    // KZO-196: AU-only GICS sector filter dropdown
    sectorSelect: Locator;
    // KZO-196: per-row GICS industry-group label
    itemIndustryLabel: (ticker: string) => Locator;
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
            `Account Create Market Card (${currency})`,
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
      accountsList: {
        searchInput: this.locate("accounts-tab-search", "Accounts Tab Search Input"),
        card: (accountId: string) =>
          this.locate(`accounts-card-${accountId}`, `Accounts Card (${accountId})`),
        cardToggle: (accountId: string) =>
          this.locate(`accounts-card-${accountId}-toggle`, `Accounts Card Toggle (${accountId})`),
        marketBadge: (accountId: string) =>
          this.locate(
            `accounts-card-${accountId}-market-badge`,
            `Accounts Card Market Badge (${accountId})`,
          ),
        accountProfileSelect: (accountId: string) =>
          this.locate(
            `settings-account-profile-${accountId}`,
            `Account Profile Select (${accountId})`,
          ),
        addProfile: (accountId: string) =>
          this.locate(
            `accounts-card-${accountId}-add-profile`,
            `Add Profile Button (${accountId})`,
          ),
        duplicateCta: (accountId: string) =>
          this.locate(
            `accounts-card-${accountId}-duplicate-cta`,
            `Duplicate-from-another-account CTA (${accountId})`,
          ),
        addOverride: (accountId: string) =>
          this.locate(
            `accounts-card-${accountId}-add-override`,
            `Add Override Button (${accountId})`,
          ),
        duplicatePicker: this.locate("accounts-duplicate-picker", "Duplicate Profile Picker"),
        duplicateSourceSelect: this.locate(
          "accounts-duplicate-source-select",
          "Duplicate Source Account Select",
        ),
        duplicateConfirm: this.locate(
          "accounts-duplicate-confirm",
          "Duplicate Confirm Button",
        ),
        duplicateCancel: this.locate(
          "accounts-duplicate-cancel",
          "Duplicate Cancel Button",
        ),
        duplicateCheckbox: (profileId: string) =>
          this.locate(
            `accounts-duplicate-checkbox-${profileId}`,
            `Duplicate Profile Checkbox (${profileId})`,
          ),
        profileRows: (accountId: string) =>
          this.withDescription(
            this.page.locator(`[data-testid^="accounts-card-${accountId}-profile-"]`),
            `Profile Rows (${accountId})`,
          ),
        profileRow: (accountId: string, profileId: string) =>
          this.locate(
            `accounts-card-${accountId}-profile-${profileId}`,
            `Profile Row (${accountId}/${profileId})`,
          ),
        profileEditButton: (profileId: string) =>
          this.locate(`accounts-profile-edit-${profileId}`, `Profile Edit Button (${profileId})`),
        profileNameInput: (profileId: string) =>
          this.locate(`accounts-profile-name-input-${profileId}`, `Profile Name Input (${profileId})`),
        profileEditDoneButton: (profileId: string) =>
          this.locate(`accounts-profile-edit-done-${profileId}`, `Profile Edit Done (${profileId})`),
        // ui-enhancement — Item 1: per-account Delete + modals + recently-deleted.
        deleteButton: (accountId: string) =>
          this.locate(`account-delete-btn-${accountId}`, `Account Delete Button (${accountId})`),
        softDeleteModal: this.locate("account-soft-delete-modal", "Soft Delete Modal"),
        softDeleteConfirmButton: this.locate(
          "account-soft-delete-confirm-btn",
          "Soft Delete Confirm Button",
        ),
        softDeleteCancelButton: this.locate(
          "account-soft-delete-cancel-btn",
          "Soft Delete Cancel Button",
        ),
        softDeleteWarningOpenPositions: this.locate(
          "account-soft-delete-warning-open-positions",
          "Soft Delete Warning — Open Positions",
        ),
        softDeleteWarningCashBalance: this.locate(
          "account-soft-delete-warning-cash-balance",
          "Soft Delete Warning — Cash Balance",
        ),
        softDeleteWarningLastAccount: this.locate(
          "account-soft-delete-warning-last-account",
          "Soft Delete Warning — Last Account",
        ),
        permanentDeleteModal: this.locate(
          "account-permanent-delete-modal",
          "Permanent Delete Modal",
        ),
        permanentDeleteInput: this.locate(
          "account-permanent-delete-input",
          "Permanent Delete Typed-Name Input",
        ),
        permanentDeleteConfirmButton: this.locate(
          "account-permanent-delete-confirm-btn",
          "Permanent Delete Confirm Button",
        ),
        permanentDeleteCancelButton: this.locate(
          "account-permanent-delete-cancel-btn",
          "Permanent Delete Cancel Button",
        ),
        recentlyDeletedSection: this.locate(
          "recently-deleted-section",
          "Recently Deleted Section",
        ),
        recentlyDeletedHeader: this.locate(
          "recently-deleted-header",
          "Recently Deleted Header",
        ),
        recentlyDeletedRow: (accountId: string) =>
          this.locate(
            `recently-deleted-row-${accountId}`,
            `Recently Deleted Row (${accountId})`,
          ),
        recentlyDeletedRestoreButton: (accountId: string) =>
          this.locate(
            `recently-deleted-restore-btn-${accountId}`,
            `Recently Deleted Restore Button (${accountId})`,
          ),
        recentlyDeletedPurgeButton: (accountId: string) =>
          this.locate(
            `recently-deleted-purge-btn-${accountId}`,
            `Recently Deleted Purge Button (${accountId})`,
          ),
        recentlyDeletedTimeRemaining: (accountId: string) =>
          this.locate(
            `recently-deleted-time-remaining-${accountId}`,
            `Recently Deleted Time Remaining (${accountId})`,
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
        // KZO-194: all catalog-item-* rows currently rendered (respects the
        // incremental-render window). Use for count assertions (≥N rows).
        allItems: this.withDescription(
          this.page.locator('[data-testid^="catalog-item-"]'),
          "All Catalog Items",
        ),
        itemCheckbox: (ticker: string) =>
          this.withinByCss(
            this.locate(`catalog-item-${ticker}`),
            "input[type=checkbox]",
            `Catalog Item Checkbox ${ticker}`,
          ),
        // KZO-188: market chip group buttons (All · TW · US · AU).
        // Implementer uses testid `catalog-market-chip-{market}` with lowercase
        // market code (e.g. `catalog-market-chip-au`).
        marketChip: (market: "all" | "TW" | "US" | "AU") =>
          this.locate(
            `catalog-market-chip-${market.toLowerCase()}`,
            `Market Chip ${market}`,
          ),
        // KZO-188: LIVE badge for a live-sourced catalog row.
        // Implementer uses a top-level testid `catalog-live-badge-{ticker}`
        // (not nested inside the item row).
        liveItemBadge: (ticker: string) =>
          this.locate(`catalog-live-badge-${ticker}`, `Live Badge ${ticker}`),
        // KZO-188: error message rendered when live search backend is degraded
        liveUnavailableMessage: this.locate(
          "catalog-live-unavailable",
          "Catalog Live Unavailable Message",
        ),
        // KZO-188: in-flight indicator while live search request is pending
        liveSearchingMessage: this.locate(
          "catalog-live-loading",
          "Catalog Live Searching Indicator",
        ),
        // KZO-196: AU-only GICS sector filter dropdown (rendered only when
        // `marketChip === "AU"`). Architect-locked testid:
        // `catalog-sector-filter`.
        sectorSelect: this.locate("catalog-sector-filter", "Catalog Sector Filter"),
        // KZO-196: per-row industry-group label (rendered only when
        // `gicsIndustryGroup != null`). Architect-locked testid:
        // `catalog-row-industry-group-{ticker}`.
        itemIndustryLabel: (ticker: string) =>
          this.locate(
            `catalog-row-industry-group-${ticker}`,
            `Catalog Row Industry Group ${ticker}`,
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
