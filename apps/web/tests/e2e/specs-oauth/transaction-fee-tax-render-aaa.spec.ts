// ui-enhancement — AAA E2E for the Record Transaction fee/tax render gate.
//
// Coverage (Items 2, 3 from scope-todo §):
//   [tuple-gate-pos]   Section appears when all 4 fields hold (accountId,
//                      ticker, quantity>0, unitPrice>0).
//   [tuple-gate-neg]   Section does NOT appear when ticker is empty
//                      (representative negative case for the 4-tuple gate).
//   [unavailable-degrade] When 4-tuple holds but the estimate endpoint fails,
//                         the section STILL renders with "estimate unavailable"
//                         copy + override input.
//   [override-persistence] Typed override in commissionOverrideInput persists
//                          across quantity changes (no auto-clear).
//   [tax-buy-absent]   Tax section absent for BUY (gate by `value.type === "SELL"`).
//
// Reserved ticker: ACCDEL04 per
// `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. Seeded into the
// instrument catalog so `selectTickerOption` can commit a ticker value
// (typing-only into the combobox does NOT commit `value.ticker`).

import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

const ACCDEL04 = {
  ticker: "ACCDEL04",
  name: "Synthetic ACCDEL04 Fixture",
  instrumentType: "STOCK" as const,
  marketCode: "TW" as const,
  barsBackfillStatus: "pending",
};

test.describe("ui-enhancement — AddTransactionCard fee/tax 4-tuple render gate", () => {
  test("[tuple-gate-pos] commission-estimate-section appears once all 4 fields hold", async ({
    appShell,
    settings,
    transactions,
  }) => {
    await settings.arrange.seedInstruments([ACCDEL04]);
    await appShell.actions.navigateToRoute("/transactions");

    // Drive form to a 4-tuple-holding state.
    await transactions.actions.selectFirstAccount();
    await transactions.actions.typeInTickerSearch("ACCDEL04");
    await transactions.actions.selectTickerOption("ACCDEL04", "TW");
    await transactions.actions.fillQuantity(10);
    await transactions.actions.fillUnitPrice(100);

    await transactions.assert.commissionEstimateSectionIsVisible();
  });

  test("[tuple-gate-neg] commission-estimate-section stays absent when ticker is empty", async ({
    appShell,
    transactions,
  }) => {
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.actions.selectFirstAccount();
    // ticker intentionally not committed (no selectTickerOption call).
    await transactions.actions.fillQuantity(10);
    await transactions.actions.fillUnitPrice(100);

    await transactions.assert.commissionEstimateSectionIsAbsent();
  });

  test("[unavailable-degrade] section renders 'estimate unavailable' copy with the override input present", async ({
    appShell,
    settings,
    transactions,
  }) => {
    await transactions.arrange.stubTransactionEstimateFailure();
    await settings.arrange.seedInstruments([ACCDEL04]);
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.actions.selectFirstAccount();
    await transactions.actions.typeInTickerSearch("ACCDEL04");
    await transactions.actions.selectTickerOption("ACCDEL04", "TW");
    await transactions.actions.fillQuantity(10);
    await transactions.actions.fillUnitPrice(100);

    await transactions.assert.commissionEstimateSectionIsVisible();
    await transactions.assert.commissionEstimateUnavailableIsVisible();
    await transactions.assert.commissionOverrideInputIsVisible();
  });

  test("[override-persistence] typed commission override survives quantity changes", async ({
    appShell,
    settings,
    transactions,
  }) => {
    await settings.arrange.seedInstruments([ACCDEL04]);
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.actions.selectFirstAccount();
    await transactions.actions.typeInTickerSearch("ACCDEL04");
    await transactions.actions.selectTickerOption("ACCDEL04", "TW");
    await transactions.actions.fillQuantity(10);
    await transactions.actions.fillUnitPrice(100);

    await transactions.actions.fillCommissionOverride("42.50");
    await transactions.actions.fillQuantity(20);

    await transactions.assert.commissionOverrideValueIs("42.50");
  });

  test("[tax-buy-absent] tax-estimate-section is absent for BUY", async ({
    appShell,
    settings,
    transactions,
  }) => {
    await settings.arrange.seedInstruments([ACCDEL04]);
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.actions.selectFirstAccount();
    await transactions.actions.selectTransactionType("BUY");
    await transactions.actions.typeInTickerSearch("ACCDEL04");
    await transactions.actions.selectTickerOption("ACCDEL04", "TW");
    await transactions.actions.fillQuantity(10);
    await transactions.actions.fillUnitPrice(100);

    await transactions.assert.taxEstimateSectionIsAbsent();
  });
});
