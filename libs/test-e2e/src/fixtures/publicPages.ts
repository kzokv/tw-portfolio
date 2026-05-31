import { createWebFixture } from "@vakwen/test-framework/config";

import type { TAnonymousShareAssistant } from "../assistants/sharing/index.js";
import { AnonymousSharePage } from "../pages/sharing/AnonymousSharePage.js";

import { test as base } from "./noAuthBase.js";

export interface TPublicPagesFixtures {
  anonymousShare: TAnonymousShareAssistant;
}

export const test = base.extend<TPublicPagesFixtures>({
  anonymousShare: createWebFixture<TAnonymousShareAssistant>(AnonymousSharePage),
});

export { expect } from "./noAuthBase.js";
