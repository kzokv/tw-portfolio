import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TSettingsAssistant } from "../assistants/settings/index.js";
import { SettingsDrawerPage } from "../pages/settings/SettingsDrawerPage.js";

import { test as base } from "./appShell.js";

export interface TSettingsFixtures {
  settings: TSettingsAssistant;
}

export const test = base.extend<TSettingsFixtures>({
  settings: createWebFixture<TSettingsAssistant>(SettingsDrawerPage),
});

export { expect } from "./appShell.js";
