import type { AppShellPage } from "../pages/layout/AppShellPage.js";
import type { TAppShellAssistant } from "../assistants/layout/index.js";

import { test as base } from "./base.js";
import { AppShellPage as AppShellPageClass } from "../pages/layout/AppShellPage.js";

export interface TAppShellFixtures {
  appShell: TAppShellAssistant;
}

export const test = base.extend<TAppShellFixtures>({
  appShell: async ({ testUser }, use) => {
    await use(await testUser.useWebAssistant<AppShellPage, TAppShellAssistant>(AppShellPageClass));
  },
});

export { expect } from "./base.js";
