// ui-enhancement — AAA E2E for the Record Transaction market chip cleanup
// (Item 4 from scope-todo).
//
// Coverage:
//   [no-all]    `tx-market-chip-ALL` testid never renders (scope item 20).
//   [chips]     TW + US + AU chips remain visible.
//
// Reserved ticker: ACCDEL05 per
// `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. (The auto-sync
// cross-market case requires a non-default-currency seeded account which
// the default test seed doesn't provide; the auto-sync behavior is fully
// covered by the web-unit spec `AddTransactionCard.uiEnhancement.test.tsx`
// — see the live-DOM "chip auto-sync + ticker clear" test.)

import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";

test.describe("ui-enhancement — Market chip cleanup (Record Transaction)", () => {
  test("[no-all] tx-market-chip-ALL is never rendered", async ({ appShell, transactions }) => {
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.assert.marketChipIsAbsent("ALL");
    await transactions.assert.marketChipIsVisible("TW");
    await transactions.assert.marketChipIsVisible("US");
    await transactions.assert.marketChipIsVisible("AU");
  });
});
