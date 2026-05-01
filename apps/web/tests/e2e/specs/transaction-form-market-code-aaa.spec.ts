/**
 * KZO-169 — Transaction form market_code selector + symbol disambiguation.
 *
 * Covers the browser-facing acceptance criteria that are not visible from the
 * HTTP suite: chip defaults, filtered autocomplete rows, ALL-mode suffixes,
 * account dropdown filtering, currency lock, and no-compatible-account UX.
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import type { TSettingsAssistant } from "@tw-portfolio/test-e2e/assistants/settings";

const BHP_AU = {
  ticker: "BHP",
  name: "BHP Group Limited",
  instrumentType: "STOCK",
  marketCode: "AU",
  barsBackfillStatus: "ready",
};

const BHP_US = {
  ticker: "BHP",
  name: "BHP Group Sponsored ADR",
  instrumentType: "STOCK",
  marketCode: "US",
  barsBackfillStatus: "ready",
};

async function createAccount(
  settings: TSettingsAssistant,
  name: string,
  currency: "USD" | "AUD",
): Promise<void> {
  await settings.actions.fillAccountCreateName(name);
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency(currency);
  await settings.actions.submitAccountCreate();
}

test("[transactions]: multi-currency user gets All chip, disambiguated BHP rows, and USD account filtering", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed ambiguous ticker rows + create USD/AUD accounts ────────
  await settings.arrange.seedInstruments([BHP_AU, BHP_US]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();
  await createAccount(settings, "USD Brokerage", "USD");
  await createAccount(settings, "AUD Brokerage", "AUD");
  await settings.actions.closeWithEscape();

  // ── Assert: mixed account currencies default the chip to All ─────────────
  await transactions.actions.navigateToTransactions();
  await transactions.assert.selectedMarketChipIs("ALL");

  // ── Act/Assert: AU chip filters autocomplete to AU-only BHP ──────────────
  await transactions.actions.selectMarketChip("AU");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/BHP/);

  // ── Act/Assert: All chip shows both ambiguous rows with market suffixes ──
  await transactions.actions.selectMarketChip("ALL");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(2);
  await transactions.assert.comboboxOptionContains(/BHP\s*·\s*AU/);
  await transactions.assert.comboboxOptionContains(/BHP\s*·\s*US/);

  // ── Act/Assert: selecting BHP·US locks currency + account dropdown ───────
  await transactions.actions.selectTickerOption("BHP", "US");
  await transactions.assert.selectedTickerContains(/BHP\s*·\s*US/);
  await transactions.assert.priceCurrencyIs("USD");
  await transactions.assert.selectedAccountOptionsContain(/USD Brokerage/);
  await transactions.assert.selectedAccountOptionsExclude(/Main/);
  await transactions.assert.selectedAccountOptionsExclude(/AUD Brokerage/);
});

test("[transactions]: AU instrument with no AUD account renders create-account path and blocks submit", async ({
  settings,
  transactions,
}) => {
  // ── Arrange: default user has only a TWD account; seed one AU instrument ──
  await settings.arrange.seedInstruments([BHP_AU]);

  // ── Act: choose the AU chip and commit BHP·AU ────────────────────────────
  await transactions.actions.navigateToTransactions();
  await transactions.actions.selectMarketChip("AU");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.actions.selectTickerOption("BHP", "AU");

  // ── Assert: no compatible account state replaces the account dropdown ────
  await transactions.assert.priceCurrencyIs("AUD");
  await transactions.assert.noAccountErrorContains(/AUD/);
  await transactions.assert.createAccountLinkHrefContains(/accountsPrefillCurrency=AUD/);
  await transactions.assert.submitButtonIsDisabled();
});
