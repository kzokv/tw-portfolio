import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";
import { readAppConfig, resetAppConfig } from "./helpers/adminSettings.js";

test.describe("admin settings — UI (KZO-142)", () => {
  test.beforeEach(async () => {
    await resetAppConfig();
  });

  test("[admin settings]: sidebar Settings link has aria-current=page", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.assert.adminSettingsPageIsVisible();
    await appShell.assert.adminSettingsSidebarLinkIsCurrent();
  });

  test("[admin settings]: fresh state — toggle OFF and env-default badge visible", async ({
    appShell,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.assert.adminSettingsPageIsVisible();
    await appShell.assert.adminSettingsOverrideToggleChecked(false);
    await appShell.assert.adminSettingsEnvDefaultBadgeIsVisible();
  });

  test("[admin settings]: toggle ON → number input appears; env-default badge hidden", async ({
    appShell,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.actions.toggleAdminSettingsOverride(true);

    await appShell.assert.adminSettingsMinutesInputIsVisible();
    await appShell.assert.adminSettingsEnvDefaultBadgeIsHidden();
  });

  test("[admin settings]: enter 45 → Save → value persists and updatedAt footer present", async ({
    appShell,
    testUser,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.actions.toggleAdminSettingsOverride(true);
    await appShell.actions.fillAdminSettingsMinutes("45");
    await appShell.actions.clickAdminSettingsSave();

    await appShell.assert.adminSettingsSaveSuccessIsVisible();
    await appShell.assert.adminSettingsMinutesInputHasValue("45");
    await appShell.assert.adminSettingsLastUpdatedIsVisible();

    const config = await readAppConfig(testUser.userId);
    await appShell.assert.mxAssertEqual(config.repairCooldownMinutes, 45, "repairCooldownMinutes");
  });

  test("[admin settings]: toggle OFF (while value set) → Save → env badge returns; null via API", async ({
    appShell,
    testUser,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.actions.toggleAdminSettingsOverride(true);
    await appShell.actions.fillAdminSettingsMinutes("60");
    await appShell.actions.clickAdminSettingsSave();
    await appShell.assert.adminSettingsSaveSuccessIsVisible();

    await appShell.actions.toggleAdminSettingsOverride(false);
    await appShell.actions.clickAdminSettingsSave();

    await appShell.assert.adminSettingsEnvDefaultBadgeIsVisible();
    await appShell.assert.adminSettingsMinutesInputIsHidden();

    const config = await readAppConfig(testUser.userId);
    await appShell.assert.mxAssertEqual(config.repairCooldownMinutes, null, "repairCooldownMinutes");
  });

  test("[admin settings]: toggle ON + value 0 → validation error visible; Save disabled", async ({
    appShell,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");

    await appShell.actions.toggleAdminSettingsOverride(true);
    await appShell.actions.fillAdminSettingsMinutes("0");

    await appShell.assert.adminSettingsValidationErrorIsVisible();
    await appShell.assert.adminSettingsSaveButtonIsDisabled();
  });
});
