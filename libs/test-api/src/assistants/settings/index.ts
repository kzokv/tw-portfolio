import { createAssistantFactory } from "@tw-portfolio/test-framework/config";
import { SettingsApiActions } from "./SettingsApiActions.js";
import { SettingsApiArrange } from "./SettingsApiArrange.js";
import { SettingsApiAssert } from "./SettingsApiAssert.js";

export const settingsApiAssistantFactory = createAssistantFactory({
  Arrange: SettingsApiArrange,
  Actions: SettingsApiActions,
  Assert: SettingsApiAssert,
});

export type TSettingsApiAssistant = ReturnType<typeof settingsApiAssistantFactory>;

export * from "./SettingsApiActions.js";
export * from "./SettingsApiArrange.js";
export * from "./SettingsApiAssert.js";
