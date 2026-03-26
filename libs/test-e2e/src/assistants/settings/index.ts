import { createAssistantFactory } from "@tw-portfolio/test-framework/config";

import { SettingsActions } from "./SettingsActions.js";
import { SettingsArrange } from "./SettingsArrange.js";
import { SettingsAssert } from "./SettingsAssert.js";

export const settingsAssistantFactory = createAssistantFactory({
  Arrange: SettingsArrange,
  Actions: SettingsActions,
  Assert: SettingsAssert,
});

export type TSettingsAssistant = ReturnType<typeof settingsAssistantFactory>;

export * from "./SettingsArrange.js";
export * from "./SettingsActions.js";
export * from "./SettingsAssert.js";
