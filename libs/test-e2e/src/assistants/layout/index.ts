import { createAssistantFactory } from "@vakwen/test-framework/config";

import { AppShellActions } from "./AppShellActions.js";
import { AppShellArrange } from "./AppShellArrange.js";
import { AppShellAssert } from "./AppShellAssert.js";

export const appShellAssistantFactory = createAssistantFactory({
  Arrange: AppShellArrange,
  Actions: AppShellActions,
  Assert: AppShellAssert,
});

export type TAppShellAssistant = ReturnType<typeof appShellAssistantFactory>;

export * from "./AppShellArrange.js";
export * from "./AppShellActions.js";
export * from "./AppShellAssert.js";
