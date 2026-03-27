import { createWebFixture } from "@tw-portfolio/test-framework/config";

import type { TLoginAssistant } from "../assistants/auth/index.js";
import { LoginPage } from "../pages/auth/index.js";

import { test as base } from "./noAuthBase.js";

export interface TLoginFixtures {
  login: TLoginAssistant;
}

export const test = base.extend<TLoginFixtures>({
  login: createWebFixture<TLoginAssistant>(LoginPage),
});

export { expect } from "./noAuthBase.js";
