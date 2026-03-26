import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { SideNavigationComponent } from "./SideNavigationComponent.js";
import { TopBarComponent } from "./TopBarComponent.js";

export interface TAppShellElements {
  appReady: Locator;
  globalError: Locator;
  topBar: TopBarComponent;
  sideNavigation: SideNavigationComponent;
  settings: {
    drawer: Locator;
    localeValue: Locator;
    costBasisValue: Locator;
    quotePollValue: Locator;
  };
}

export class AppShellPage extends BasePage<TAppShellElements> {
  protected initializeElements(): void {
    this._elements = {
      appReady: this.locate("app-shell-ready", "App Shell Ready Marker"),
      globalError: this.locate("global-error-banner", "Global Error Banner"),
      topBar: new TopBarComponent(this.page),
      sideNavigation: new SideNavigationComponent(this.page),
      settings: {
        drawer: this.locate("settings-drawer", "Settings Drawer"),
        localeValue: this.locate("settings-locale-value", "Locale Summary Value"),
        costBasisValue: this.locate("settings-cost-basis-value", "Cost Basis Summary Value"),
        quotePollValue: this.locate("settings-quote-poll-value", "Quote Poll Summary Value"),
      },
    };
  }
}
