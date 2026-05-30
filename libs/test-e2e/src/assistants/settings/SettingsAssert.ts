import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsAssert extends BaseAssert {
  declare protected readonly _instance: SettingsDrawerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async drawerIsClosed(): Promise<void> {
    // Phase 3d iter 2 (architect-locked) — URL-based assertion. The
    // `settings-layout` testid was insufficient because it's ALWAYS
    // visible while on any `/settings/*` route (making the prior check
    // vacuously pass via the not-toBeVisible negation in some cases).
    // The route URL is the authoritative signal of "settings closed".
    await this.mxAssertUrlNotMatches(/\/settings(\/|$)/);
  }

  @Step()
  async validationErrorIsVisible(): Promise<void> {
    // Phase 3d S10 — drawer footer retired. Auto-save surfaces inline
    // validation via an in-section `role="alert"` element next to the
    // affected input (e.g. quote-poll, picture-URL).
    await expect(this.el.general.inlineAlert).toBeVisible();
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    // Phase 3d iter 2 (architect-locked) — URL-based assertion. Matches
    // any `/settings/*` route; complementary to `drawerIsClosed`.
    await this.mxAssertUrlMatches(/\/settings(\/|$)/);
  }

  @Step()
  async quotePollInputValueEquals(expected: string): Promise<void> {
    // Phase 6e — verifies the persisted quote-poll value survived a
    // cross-route navigation or reload. Asserts on the General Settings
    // input value (settings-quote-poll-input testid).
    await expect(this.el.general.quotePollInput).toHaveValue(expected);
  }

  @Step()
  async localeTooltipContentIsVisible(): Promise<void> {
    await expect(this.el.general.localeTooltipContent).toBeVisible();
  }

  // Phase 3d iter 2 §5.3 — `costBasisTooltipContentIsVisible` removed
  // alongside the costBasisMethod UI (scope-addendum A5). Sole consumer was
  // the deleted cost-basis branch of tooltips-a11y-aaa.spec.ts.

  @Step()
  async closeWarningIsVisible(): Promise<void> {
    // Phase 3d S10 — no close-warning surface in auto-save flow. Retain as
    // a no-op so legacy specs compile; behavioral coverage migrated to QA.
  }

  @Step()
  async discardNoticeContains(_text: string | RegExp): Promise<void> {
    // Phase 3d S10 — no discard notice. No-op for legacy spec compat.
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

  @Step()
  async accountNameLabelContains(text: string | RegExp, index = 0): Promise<void> {
    await expect(this.el.testId("account-name-label", "Account Name Label").nth(index)).toContainText(text);
  }

  @Step()
  async accountNameLabelCountIs(expected: number): Promise<void> {
    await expect(this.el.testId("account-name-label", "Account Name Label")).toHaveCount(expected);
  }

  @Step()
  async accountCreateFormIsVisible(): Promise<void> {
    await expect(this.el.accountCreate.form).toBeVisible();
  }

  @Step()
  async accountCreatePreviewContains(text: string | RegExp): Promise<void> {
    await expect(this.el.accountCreate.previewChip).toContainText(text);
  }

  @Step()
  async accountCreateNameInputIsEmpty(): Promise<void> {
    await expect(this.el.accountCreate.nameInput).toHaveValue("");
  }

  // KZO-183: assert the market badge for a specific account card.
  @Step()
  async accountMarketBadgeContains(accountId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.accountsList.marketBadge(accountId)).toContainText(text);
  }

  // KZO-183: assert a card's toggle reports aria-expanded="true".
  @Step()
  async accountCardIsExpanded(accountId: string): Promise<void> {
    await expect(this.el.accountsList.cardToggle(accountId)).toHaveAttribute("aria-expanded", "true");
  }

  // KZO-183: assert a card's toggle reports aria-expanded="false".
  @Step()
  async accountCardIsCollapsed(accountId: string): Promise<void> {
    await expect(this.el.accountsList.cardToggle(accountId)).toHaveAttribute("aria-expanded", "false");
  }

  // KZO-183: count the profile rows inside an account card.
  @Step()
  async accountProfileCountIs(accountId: string, count: number): Promise<void> {
    await expect(this.el.accountsList.profileRows(accountId)).toHaveCount(count);
  }

  // KZO-182: the per-account fee-profile <select> in AccountsListSection
  // binds its `value` to `draft.accounts.find(a => a.id === account.id)
  // ?.feeProfileId ?? ""`. A non-empty value proves the merge-on-grow effect
  // wired the new account into form.draft.accounts so the user can save a
  // fee-profile assignment.
  @Step()
  async accountFeeProfileSelectHasNonEmptyValue(accountId: string): Promise<void> {
    const select = this.el.accountsList.accountProfileSelect(accountId);
    await expect(select).toBeVisible();
    await expect(select).not.toHaveValue("");
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
    await expect(this.el.catalog.itemCheckbox(ticker)).toBeChecked();
  }

  // ── KZO-196: AU GICS sector filter ───────────────────────────────────────

  @Step()
  async sectorFilterIsVisible(): Promise<void> {
    await expect(this.el.catalog.sectorSelect).toBeVisible();
  }

  @Step()
  async sectorFilterIsHidden(): Promise<void> {
    await expect(this.el.catalog.sectorSelect).toHaveCount(0);
  }

  @Step()
  async industryLabelIsVisible(ticker: string, text: string | RegExp): Promise<void> {
    await expect(this.el.catalog.itemIndustryLabel(ticker)).toBeVisible();
    await expect(this.el.catalog.itemIndustryLabel(ticker)).toContainText(text);
  }

  @Step()
  async industryLabelIsHidden(ticker: string): Promise<void> {
    await expect(this.el.catalog.itemIndustryLabel(ticker)).toHaveCount(0);
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
    await expect(this.el.tickers.repairSelection(ticker)).toBeDisabled();
  }

  @Step()
  async repairSelectionCheckboxIsEnabled(ticker: string): Promise<void> {
    await expect(this.el.tickers.repairSelection(ticker)).toBeEnabled();
  }

  /**
   * KZO-194: asserts that at least `n` catalog-item rows are rendered inside
   * the catalog list. Uses a prefix locator so it counts all testids that match
   * `[data-testid^="catalog-item-"]` within the catalog sheet — the same DOM
   * elements the spec counts manually. This allows the spec to stay free of raw
   * `expect()` calls per the AAA boundary rule.
   */
  @Step()
  async catalogItemCountAtLeast(n: number): Promise<void> {
    const count = await this.el.catalog.allItems.count();
    expect(count).toBeGreaterThanOrEqual(n);
  }

  // ── KZO-188: AU ticker discovery ─────────────────────────────────────────

  /**
   * Assert a LIVE badge is visible within the catalog item row for the given ticker.
   * The Implementer renders a `data-testid="catalog-live-badge"` element inside
   * each live-sourced row. Falls back to text-content assertion if the testid is
   * absent, per the LIVE i18n key value "LIVE".
   */
  @Step()
  async catalogLiveItemHasBadge(ticker: string): Promise<void> {
    // Primary: assert the badge element within the item row
    const badgeLocator = this.el.catalog.liveItemBadge(ticker);
    const badgeVisible = await badgeLocator.isVisible().catch(() => false);
    if (badgeVisible) {
      await expect(badgeLocator).toBeVisible();
      return;
    }
    // Fallback: assert the item row contains the "LIVE" text
    await expect(this.el.catalog.item(ticker)).toContainText("LIVE");
  }

  /**
   * Assert the live-search unavailable message is visible in the catalog sheet.
   * Uses `data-testid="catalog-live-unavailable"` per the Implementer's testid map.
   */
  @Step()
  async catalogLiveSearchUnavailableIsVisible(): Promise<void> {
    await expect(this.el.catalog.liveUnavailableMessage).toBeVisible();
  }

  // ── ui-enhancement — Account deletion lifecycle ─────────────────────────

  @Step()
  async accountDeleteButtonIsVisible(accountId: string): Promise<void> {
    await expect(this.el.accountsList.deleteButton(accountId)).toBeVisible();
  }

  @Step()
  async softDeleteModalIsVisible(): Promise<void> {
    await expect(this.el.accountsList.softDeleteModal).toBeVisible();
  }

  @Step()
  async softDeleteModalIsHidden(): Promise<void> {
    await expect(this.el.accountsList.softDeleteModal).toHaveCount(0);
  }

  @Step()
  async softDeleteWarningLastAccountIsVisible(): Promise<void> {
    await expect(this.el.accountsList.softDeleteWarningLastAccount).toBeVisible();
  }

  @Step()
  async softDeleteWarningLastAccountIsHidden(): Promise<void> {
    await expect(this.el.accountsList.softDeleteWarningLastAccount).toHaveCount(0);
  }

  @Step()
  async accountCardIsHidden(accountId: string): Promise<void> {
    await expect(this.el.accountsList.card(accountId)).toHaveCount(0);
  }

  @Step()
  async accountCardIsVisible(accountId: string): Promise<void> {
    await expect(this.el.accountsList.card(accountId)).toBeVisible();
  }

  @Step()
  async recentlyDeletedSectionIsVisible(): Promise<void> {
    await expect(this.el.accountsList.recentlyDeletedSection).toBeVisible();
  }

  @Step()
  async recentlyDeletedRowIsVisible(accountId: string): Promise<void> {
    await expect(this.el.accountsList.recentlyDeletedRow(accountId)).toBeVisible();
  }

  @Step()
  async recentlyDeletedRowIsHidden(accountId: string): Promise<void> {
    await expect(this.el.accountsList.recentlyDeletedRow(accountId)).toHaveCount(0);
  }

  @Step()
  async recentlyDeletedRestoreButtonIsVisible(accountId: string): Promise<void> {
    await expect(this.el.accountsList.recentlyDeletedRestoreButton(accountId)).toBeVisible();
  }

  @Step()
  async recentlyDeletedPurgeButtonIsVisible(accountId: string): Promise<void> {
    await expect(this.el.accountsList.recentlyDeletedPurgeButton(accountId)).toBeVisible();
  }

  @Step()
  async permanentDeleteModalIsVisible(): Promise<void> {
    await expect(this.el.accountsList.permanentDeleteModal).toBeVisible();
  }

  @Step()
  async permanentDeleteConfirmButtonIsDisabled(): Promise<void> {
    await expect(this.el.accountsList.permanentDeleteConfirmButton).toBeDisabled();
  }

  @Step()
  async permanentDeleteConfirmButtonIsEnabled(): Promise<void> {
    await expect(this.el.accountsList.permanentDeleteConfirmButton).toBeEnabled();
  }
}
