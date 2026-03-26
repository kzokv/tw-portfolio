import { webAssistantRegistry } from "@tw-portfolio/test-framework/config";

import { appShellAssistantFactory } from "../assistants/layout/index.js";
import { settingsAssistantFactory } from "../assistants/settings/index.js";
import { AppShellPage } from "../pages/layout/AppShellPage.js";
import { SettingsDrawerPage } from "../pages/settings/SettingsDrawerPage.js";

let registered = false;

export function registerTestE2EAssistants(): void {
  if (registered) {
    return;
  }

  webAssistantRegistry
    .register(AppShellPage, appShellAssistantFactory)
    .register(SettingsDrawerPage, settingsAssistantFactory);

  registered = true;
}

registerTestE2EAssistants();
