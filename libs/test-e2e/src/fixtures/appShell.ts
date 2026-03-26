import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TAppShellAssistant } from "../assistants/layout/index.js";
import { AppShellPage } from "../pages/layout/AppShellPage.js";

import { test as base } from "./base.js";

export interface TAppShellFixtures {
  appShell: TAppShellAssistant;
}

export const test = base.extend<TAppShellFixtures>({
  appShell: createWebFixture<TAppShellAssistant>(AppShellPage),
});

export { expect } from "./base.js";
