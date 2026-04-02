import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsAssert extends BaseAssert {
  declare protected readonly _instance: SettingsDrawerPage;

  private get el() {
    return this._instance.elements;
  }

  private repairCheckboxForTicker(ticker: string) {
    return this.page.getByTestId(`repair-selection-${ticker}`);
  }

  @Step()
  async drawerIsClosed(): Promise<void> {
    await this.mxAssertUrlNotMatches("drawer=settings");
    await expect(this.el.drawer).not.toBeVisible();
  }

  @Step()
  async validationErrorIsVisible(): Promise<void> {
    await expect(this.el.footer.validationError).toBeVisible();
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer).toBeVisible();
  }

  @Step()
  async localeTooltipContentIsVisible(): Promise<void> {
    await expect(this.el.general.localeTooltipContent).toBeVisible();
  }

  @Step()
  async costBasisTooltipContentIsVisible(): Promise<void> {
    await expect(this.el.general.costBasisTooltipContent).toBeVisible();
  }

  @Step()
  async closeWarningIsVisible(): Promise<void> {
    await expect(this.el.footer.closeWarning).toBeVisible();
  }

  @Step()
  async discardNoticeContains(text: string | RegExp): Promise<void> {
    await expect(this.el.footer.discardNotice).toContainText(text);
  }

  @Step()
  async profileTabIsVisible(): Promise<void> {
    await expect(this.el.tabs.profile).toBeVisible();
  }

  @Step()
  async profileSectionIsVisible(): Promise<void> {
    await expect(this.el.profile.section).toBeVisible();
  }

  @Step()
  async profileDisplayNameIsReadonlyWithValue(expectedValue: string): Promise<void> {
    await expect(this.el.profile.displayNameInput).toBeVisible();
    await expect(this.el.profile.displayNameInput).toHaveAttribute("readonly", "");
    await expect(this.el.profile.displayNameInput).toHaveValue(expectedValue);
  }

  @Step()
  async profileSectionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.profile.section).toContainText(text);
  }

  @Step()
  async profileEmailValueIs(expectedValue: string): Promise<void> {
    await expect(this.el.profile.emailInput).toHaveValue(expectedValue);
  }

  @Step()
  async profileEmailSavedIndicatorIsVisible(): Promise<void> {
    await expect(this.el.profile.emailSavedIndicator).toBeVisible();
  }

  // --- Monitored Symbols ---

  @Step()
  async tickersSectionIsVisible(): Promise<void> {
    await expect(this.el.tickers.section).toBeVisible();
  }

  @Step()
  async tickersEmptyStateIsVisible(): Promise<void> {
    await expect(this.el.tickers.emptyState).toBeVisible();
  }

  @Step()
  async catalogIsVisible(): Promise<void> {
    await expect(this.el.catalog.sheet).toBeVisible();
  }

  @Step()
  async catalogIsHidden(): Promise<void> {
    await expect(this.el.catalog.sheet).not.toBeVisible();
  }

  @Step()
  async catalogItemIsVisible(ticker: string): Promise<void> {
    await expect(this.el.catalog.item(ticker)).toBeVisible();
  }

  @Step()
  async catalogItemIsHidden(ticker: string): Promise<void> {
    await expect(this.el.catalog.item(ticker)).not.toBeVisible();
  }

  @Step()
  async catalogItemIsChecked(ticker: string): Promise<void> {
    await expect(this.el.catalog.item(ticker).locator("input[type=checkbox]")).toBeChecked();
  }

  @Step()
  async manualTickerIsVisible(ticker: string): Promise<void> {
    await expect(this.el.tickers.manualTicker(ticker)).toBeVisible();
  }

  @Step()
  async tickersSavedMessageIsVisible(): Promise<void> {
    await expect(this.el.tickers.savedMessage).toBeVisible();
  }

  @Step()
  async tickersSaveButtonIsDisabled(): Promise<void> {
    await expect(this.el.tickers.saveButton).toBeDisabled();
  }

  @Step()
  async backfillBadgeIs(ticker: string, status: string | RegExp): Promise<void> {
    await expect(this.el.tickers.backfillBadge(ticker)).toContainText(status);
  }

  @Step()
  async retryBackfillButtonIsVisible(ticker: string): Promise<void> {
    await expect(this.el.tickers.retryBackfillButton(ticker)).toBeVisible();
  }

  @Step()
  async retryBackfillButtonIsHidden(ticker: string): Promise<void> {
    await expect(this.el.tickers.retryBackfillButton(ticker)).not.toBeVisible();
  }

  @Step()
  async repairModeControlsAreVisible(): Promise<void> {
    await expect(this.el.tickers.repairCancelButton).toBeVisible();
    await expect(this.el.tickers.repairContinueButton).toBeVisible();
  }

  @Step()
  async repairModeControlsAreHidden(): Promise<void> {
    await expect(this.el.tickers.repairCancelButton).not.toBeVisible();
    await expect(this.el.tickers.repairContinueButton).not.toBeVisible();
  }

  @Step()
  async repairModalIsVisible(): Promise<void> {
    await expect(this.el.repairModal.dialog).toBeVisible();
  }

  @Step()
  async repairModalIsHidden(): Promise<void> {
    await expect(this.el.repairModal.dialog).not.toBeVisible();
  }

  @Step()
  async repairCooldownHintIsVisible(ticker: string): Promise<void> {
    await expect(this.el.tickers.repairCooldownHint(ticker)).toBeVisible();
  }

  @Step()
  async repairSelectionCheckboxIsDisabled(ticker: string): Promise<void> {
    await expect(this.repairCheckboxForTicker(ticker)).toBeDisabled();
  }

  @Step()
  async repairSelectionCheckboxIsEnabled(ticker: string): Promise<void> {
    await expect(this.repairCheckboxForTicker(ticker)).toBeEnabled();
  }
}
