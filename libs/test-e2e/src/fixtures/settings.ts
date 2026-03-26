import type { SettingsDrawerPage } from "../pages/settings/SettingsDrawerPage.js";
import type { TSettingsAssistant } from "../assistants/settings/index.js";

import { test as base } from "./appShell.js";
import { SettingsDrawerPage as SettingsDrawerPageClass } from "../pages/settings/SettingsDrawerPage.js";

export interface TSettingsFixtures {
  settings: TSettingsAssistant;
}

export const test = base.extend<TSettingsFixtures>({
  settings: async ({ testUser }, use) => {
    await use(await testUser.useWebAssistant<SettingsDrawerPage, TSettingsAssistant>(SettingsDrawerPageClass));
  },
});

export { expect } from "./appShell.js";
