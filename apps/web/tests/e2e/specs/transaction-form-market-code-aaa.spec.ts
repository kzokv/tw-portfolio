/**
 * KZO-169 — Transaction form market_code selector + symbol disambiguation.
 *
 * Covers the browser-facing acceptance criteria that are not visible from the
 * HTTP suite: chip defaults, filtered autocomplete rows, account dropdown
 * filtering, currency lock, and no-compatible-account UX.
 *
 * ui-enhancement (2026-05-13) — Item 4: the user-facing "ALL" chip is removed
 * from the transaction form (kept only in the settings catalog browser per
 * locked scope). Default chip is now the first account's market, NOT ALL.
 * Ambiguous-ticker disambiguation is exercised via the per-market chips
 * (TW/US/AU) — the ALL-mode "BHP · AU" / "BHP · US" suffix path is no
 * longer reachable from the transaction form.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { TSettingsAssistant } from "@vakwen/test-e2e/assistants/settings";

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

test("[transactions]: multi-currency user can disambiguate BHP via per-market chips + USD account filtering", async ({
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

  // ── ui-enhancement: default chip = first account's market (TWD seeded
  //    "Main" account is first → "TW"). The ALL chip is no longer rendered.
  await transactions.actions.navigateToTransactions();
  await transactions.assert.selectedMarketChipIs("TW");

  // ── Act/Assert: AU chip filters autocomplete to AU-only BHP ──────────────
  await transactions.actions.selectMarketChip("AU");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/BHP/);

  // ── Act/Assert: switching to the US chip filters to the US-only BHP ──────
  await transactions.actions.selectMarketChip("US");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/BHP/);

  // ── Act/Assert: selecting BHP·US locks the derived priceCurrency to USD.
  //    ui-enhancement (2026-05-13) — the chip→account dropdown filter has
  //    been removed (one-way binding account → chip per scope items 22–23).
  //    The account dropdown now lists ALL of the user's accounts regardless
  //    of chip; currency-mismatch enforcement lives server-side, covered by
  //    `apps/api/test/http/specs/transaction-currency-mismatch-aaa.http.spec.ts`.
  await transactions.actions.selectTickerOption("BHP", "US");
  await transactions.assert.priceCurrencyIs("USD");
});

// ui-enhancement (2026-05-13) — Chip→account dropdown filter removed
// (scope items 22–23). Currency-mismatch enforcement moved server-side; see
// `apps/api/test/http/specs/transaction-currency-mismatch-aaa.http.spec.ts`.
test("[transactions]: AU chip on BHP derives AUD priceCurrency (server-side mismatch covered by HTTP suite)", async ({
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

  // ── Assert: form-side chip → derived priceCurrency is AUD. ───────────────
  await transactions.assert.priceCurrencyIs("AUD");
});
