import { test } from "@vakwen/test-e2e/fixtures/appPages";

// Phase 5a — Tabs container merges /dividends + /dividends/review into one route
// with ?view=calendar (default) and ?view=ledger axes.
//
// Tab switch from ledger → calendar drops ledger-only params per scope-grill lock.

test("[tab-A] /dividends defaults to calendar tab", async ({ dividends }) => {
  await dividends.actions.navigateToCalendar();
  await dividends.assert.tabsContainerIsVisible();
  await dividends.assert.calendarTabIsActive();
  await dividends.assert.calendarPanelIsVisible();
});

test("[tab-B] clicking ledger tab navigates to ?view=ledger", async ({ dividends }) => {
  await dividends.actions.navigateToCalendar();
  await dividends.assert.tabsContainerIsVisible();
  await dividends.actions.clickLedgerTab();
  await dividends.assert.urlContains("view=ledger");
  await dividends.assert.ledgerTabIsActive();
  await dividends.assert.ledgerPanelIsVisible();
});

test("[tab-C] /dividends?status=needs-review auto-resolves to ledger tab", async ({ dividends }) => {
  await dividends.actions.navigateToLedgerTab();
  await dividends.assert.ledgerTabIsActive();
  await dividends.assert.ledgerPanelIsVisible();
});

test("[tab-E] tab switch ledger → calendar drops ledger-only params", async ({
  dividends,
  appShell,
}) => {
  await appShell.actions.navigateToRoute("/dividends?view=ledger&status=needs-review");
  await dividends.assert.ledgerTabIsActive();
  await dividends.actions.clickCalendarTab();
  await dividends.assert.urlDoesNotContain("status=needs-review");
  await dividends.assert.urlDoesNotContain("view=ledger");
  await dividends.assert.calendarTabIsActive();
});
