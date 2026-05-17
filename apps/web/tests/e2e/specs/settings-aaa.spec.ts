import { expect } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test.describe.configure({ mode: "default" });

/**
 * Phase 3d iter 2 (architect-locked) — rewritten from the drawer-era flow.
 * Locale + quote-poll moved to `/settings/display` (architect §6.2);
 * the omnibus Save button is retired in favor of auto-save (Decision #12).
 *
 * Test 1: navigate directly to /settings/display, commit two field
 * changes via the auto-save flow (Tab blur triggers PATCH within the
 * 600ms debounce), verify they persist across a sidebar nav + reload.
 */
test("settings persist across routes and reloads for the same seeded user", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsSection("general");

  const currentQuotePoll = await settings.actions.getQuotePollValue();
  const nextQuotePoll = getNextQuotePoll(currentQuotePoll);
  await settings.actions.changeLocale("zh-TW");
  await settings.actions.changeQuotePollInterval(nextQuotePoll);
  // `save()` is the auto-save settler — emits Tab to release focus and
  // waits for the next PATCH /settings or /user-preferences response.
  await settings.actions.save();

  // Per architect ruling — "drawer closed" is now "not on /settings/*".
  // Navigate to the dashboard to exercise the cross-route boundary, then
  // back to /settings/general to verify the saved values persist. Phase 5d/5e
  // demoted the in-dashboard RecomputeCard surface that previously echoed the
  // quote-poll value, so persistence is now verified on the settings input
  // itself.
  await appShell.actions.navigateViaSidebar("dashboard");
  await appShell.assert.isOnRoute("/dashboard");
  await appShell.assert.topBarTitleContains("儀表板");

  await appShell.actions.openSettingsSection("general");
  expect(await settings.actions.getQuotePollValue()).toBe(nextQuotePoll);

  await appShell.actions.reloadShellPage();
  // After reload the URL stays on /settings/general; re-read the input value
  // to confirm the persisted setting survives a fresh page load.
  expect(await settings.actions.getQuotePollValue()).toBe(nextQuotePoll);
});

/**
 * Phase 3d iter 2 — invalid quote-poll input no longer "keeps the drawer
 * open" (no drawer to keep open). Instead, auto-save's `validate` callback
 * (Decision #13) blocks the PATCH and surfaces an inline `role="alert"`
 * message next to the input. The user stays on /settings/display.
 */
test("invalid settings surface inline validation and do not navigate away", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/transactions");
  await appShell.actions.openSettingsSection("general");

  // Quote poll must be a positive integer — `0` triggers
  // `validationQuotePoll` in the useAutoSave validate callback.
  await settings.actions.changeQuotePollInterval("0");
  await settings.actions.save();

  await settings.assert.validationErrorIsVisible();
  await settings.assert.drawerIsVisible(); // URL-based: still on /settings/display
});
