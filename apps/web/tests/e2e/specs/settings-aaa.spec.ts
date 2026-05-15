import { test } from "@vakwen/test-e2e/fixtures/appPages";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test.describe.configure({ mode: "default" });

test("settings persist across routes and reloads for the same seeded user", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();

  const currentQuotePoll = await settings.actions.getQuotePollValue();
  const nextQuotePoll = getNextQuotePoll(currentQuotePoll);
  await settings.actions.changeLocale("zh-TW");
  await settings.actions.changeQuotePollInterval(nextQuotePoll);
  await settings.actions.save();

  await settings.assert.drawerIsClosed();
  await appShell.assert.topBarTitleContains("持倉");

  await appShell.actions.navigateViaSidebar("dashboard");

  await appShell.assert.isOnRoute("/dashboard");
  await appShell.assert.topBarTitleContains("儀表板");
  await appShell.assert.quotePollValueContains(`${nextQuotePoll} 秒`);

  await appShell.actions.reloadShellPage();

  await appShell.assert.topBarTitleContains("儀表板");
  await appShell.assert.quotePollValueContains(`${nextQuotePoll} 秒`);
});

// KZO-183: the legacy Fees tab + cross-account FeeProfilesSection were
// removed. The "invalid settings keep the drawer open + surface validation"
// behavior is now exercised through a General-tab-reachable validation
// (non-positive quote-poll interval), which the form save path enforces
// regardless of which tab the user was on when entering the drawer.
test("invalid settings keep the drawer open and surface validation", async ({
  appShell,
  settings,
}) => {
  await appShell.actions.navigateToRoute("/transactions");
  await appShell.actions.openSettingsDrawer();

  // Quote poll must be a positive integer — `0` triggers
  // `validationQuotePoll`, which is the General-tab-rooted path.
  await settings.actions.changeQuotePollInterval("0");
  await settings.actions.save();

  await appShell.assert.isOnRoute("drawer=settings");
  await settings.assert.validationErrorIsVisible();
  await settings.assert.drawerIsVisible();
});
