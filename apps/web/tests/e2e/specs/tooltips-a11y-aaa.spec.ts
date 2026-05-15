import { test } from "@vakwen/test-e2e/fixtures/appPages";

const getNextQuotePoll = (current: string): string => (current === "12" ? "10" : "12");

test("settings tooltips remain accessible", async ({ appShell, settings }) => {
  await appShell.actions.navigateToRoute("/dashboard?drawer=settings");

  await settings.assert.drawerIsVisible();
  await settings.actions.focusLocaleTooltip();
  await settings.assert.localeTooltipContentIsVisible();

  await settings.actions.focusCostBasisTooltip();
  await settings.assert.costBasisTooltipContentIsVisible();
});

test("settings unsaved-changes warning supports keep editing and discard", async ({ appShell, settings }) => {
  await appShell.actions.navigateToRoute("/dashboard?drawer=settings");

  const currentQuotePoll = await settings.actions.getQuotePollValue();
  await settings.actions.changeQuotePollInterval(getNextQuotePoll(currentQuotePoll));

  await settings.actions.cancel();
  await settings.assert.closeWarningIsVisible();

  await settings.actions.keepEditing();
  await settings.actions.discardChanges();
  await settings.assert.discardNoticeContains(/discarded|捨棄/);
});

test("transaction tooltips and shell controls stay focusable", async ({ appShell, transactions }) => {
  await transactions.actions.navigateToTransactions();

  await appShell.assert.desktopSearchIsVisible();
  await appShell.actions.focusAvatarButton();
  await appShell.assert.avatarButtonIsFocused();

  await transactions.actions.focusAccountTooltip();
  await transactions.assert.tooltipAccountContentIsVisible();
});
