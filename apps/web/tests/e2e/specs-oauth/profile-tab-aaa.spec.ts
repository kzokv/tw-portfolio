import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

test.describe("profile tab in settings drawer", () => {
  test("profile tab button is visible in settings drawer", async ({ appShell, settings }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.assert.drawerIsVisible();
    await settings.assert.profileTabIsVisible();
  });

  test("clicking profile tab shows profile section", async ({ appShell, settings }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.assert.profileSectionIsVisible();
  });

  test("display name input is read-only with a value", async ({ appShell, session, settings }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.assert.profileDisplayNameIsReadonlyWithValue("Profile E2E User");
  });

  test("Google attribution note is visible near display name", async ({ appShell, session, settings }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.assert.profileSectionContains(/Google/i);
  });

  test("email input accepts typing", async ({ appShell, session, settings }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.assert.profileEmailValueIs("profile-e2e@example.com");
    await settings.actions.clearProfileEmail();
    await settings.actions.fillProfileEmail("new-email@example.com");
    await settings.assert.profileEmailValueIs("new-email@example.com");
  });

  test("email saves and shows success indicator", async ({ appShell, session, settings }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.actions.clearProfileEmail();
    await settings.actions.fillProfileEmail(`e2e-saved-${Date.now()}@example.com`);
    const patchResponse = await settings.actions.saveProfileEmail();
    await session.assert.responseStatusIs(patchResponse, 200);
    await settings.assert.profileEmailSavedIndicatorIsVisible();
  });

  test("saved email persists after closing and reopening drawer", async ({ appShell, session, settings }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.actions.clearProfileEmail();
    const persistedEmail = `e2e-persist-${Date.now()}@example.com`;
    await settings.actions.fillProfileEmail(persistedEmail);
    await settings.actions.saveProfileEmail();
    await settings.assert.profileEmailSavedIndicatorIsVisible();

    await settings.actions.closeWithEscape();
    await settings.assert.drawerIsClosed();

    await appShell.actions.openSettingsDrawer();
    await settings.actions.openProfileTab();
    await settings.assert.profileEmailValueIs(persistedEmail);
  });
});

test.describe("avatar identity display", () => {
  test("avatar button shows picture when user has providerPictureUrl", async ({ appShell, session }) => {
    await appShell.arrange.stubAvatarImage();
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.assert.avatarImageSourceContains("profile-e2e.jpg");
  });

  test("avatar button shows initials when user has no picture", async ({ appShell, session }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken({ picture: undefined }));
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.assert.avatarShowsNoImage();
    await appShell.assert.avatarInitialsMatch(/^[A-Z]{1,2}$/);
  });

  test("avatar dropdown shows display name and email in identity header", async ({ appShell, session }) => {
    await session.actions.seedOAuthSession(makeDeterministicIdToken());
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openAvatarMenu();
    await appShell.assert.avatarIdentityContains("Profile E2E User");
    await appShell.assert.avatarIdentityContains("profile-e2e@example.com");
    await appShell.assert.avatarMenuShowsSettingsAndSignOut();
  });
});
