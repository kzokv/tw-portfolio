import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TSettingsDrawerElements {
  drawer: Locator;
  tabs: {
    profile: Locator;
    general: Locator;
    fees: Locator;
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
