import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { SHARED_TEST_IDS } from "../constants.js";
import { SearchComponent } from "./SearchComponent.js";
import { SideNavigationComponent } from "./SideNavigationComponent.js";
import { TopBarComponent } from "./TopBarComponent.js";

export interface TAppShellElements {
  appReady: Locator;
  globalError: Locator;
  impersonationBanner: Locator;
  impersonationCountdown: Locator;
  clientApiErrorToast: Locator;
  topBar: TopBarComponent;
  sideNavigation: SideNavigationComponent;
  search: SearchComponent;
  mobileNavToggle: Locator;
  mobileSidebar: Locator;
  desktopSidebar: Locator;
  desktopNavToggle: Locator;
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
      globalError: this.locate(SHARED_TEST_IDS.globalErrorBanner, "Global Error Banner"),
      impersonationBanner: this.locate("impersonation-banner", "Impersonation Banner"),
      impersonationCountdown: this.locate("impersonation-countdown", "Impersonation Countdown"),
      clientApiErrorToast: this.locate("client-api-error", "API Client Error Toast"),
      topBar: new TopBarComponent(this.page),
      sideNavigation: new SideNavigationComponent(this.page),
      search: new SearchComponent(this.page),
      mobileNavToggle: this.locate("mobile-nav-toggle", "Mobile Nav Toggle"),
      mobileSidebar: this.locate("mobile-sidebar", "Mobile Sidebar"),
      desktopSidebar: this.locate("desktop-sidebar", "Desktop Sidebar"),
      desktopNavToggle: this.locate("desktop-nav-toggle", "Desktop Nav Toggle"),
      settings: {
        drawer: this.locate("settings-drawer", "Settings Drawer"),
        localeValue: this.locate("settings-locale-value", "Locale Summary Value"),
        costBasisValue: this.locate("settings-cost-basis-value", "Cost Basis Summary Value"),
        quotePollValue: this.locate("settings-quote-poll-value", "Quote Poll Summary Value"),
      },
    };
  }
}
