import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

import { SHARED_TEST_IDS } from "../constants.js";
import { SearchComponent, type TSearchElements } from "./SearchComponent.js";
import { SideNavigationComponent, type TSideNavigationElements } from "./SideNavigationComponent.js";
import { TopBarComponent, type TTopBarElements } from "./TopBarComponent.js";

export interface TAppShellElements extends TElementLocatorHelpers {
  appReady: Locator;
  globalError: Locator;
  impersonationBanner: Locator;
  impersonationCountdown: Locator;
  clientApiErrorToast: Locator;
  topBar: TTopBarElements;
  sideNavigation: TSideNavigationElements;
  search: TSearchElements;
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
  avatarImage: Locator;
  avatarInitials: Locator;
  adminOwnDisabledActionButton: Locator;
  adminActiveTimeframeChips: Locator;
  adminFirstActiveTimeframeChip: Locator;
  timeframeCustomizeRows: Locator;
  adminMetadataEnrichmentModeSelect: Locator;
  adminMetadataEnrichmentModeSave: Locator;
  adminMetadataEnrichmentModeEffective: Locator;
}

export class AppShellPage extends BasePage<TAppShellElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      appReady: this.locate("app-shell-ready", "App Shell Ready Marker"),
      globalError: this.locate(SHARED_TEST_IDS.globalErrorBanner, "Global Error Banner"),
      impersonationBanner: this.locate("impersonation-banner", "Impersonation Banner"),
      impersonationCountdown: this.locate("impersonation-countdown", "Impersonation Countdown"),
      clientApiErrorToast: this.locate("client-api-error", "API Client Error Toast"),
      topBar: new TopBarComponent(this.page).elements,
      sideNavigation: new SideNavigationComponent(this.page).elements,
      search: new SearchComponent(this.page).elements,
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
      avatarImage: this.withinByCss(this.locate("avatar-button"), "img", "Avatar Image"),
      avatarInitials: this.withinByCss(
        this.locate("avatar-button"),
        "span[aria-hidden='true']",
        "Avatar Initials",
      ),
      adminOwnDisabledActionButton: this.withDescription(
        this.locate("users-table")
          .locator("tr", { has: this.locate("you-badge") })
          .locator("button[disabled]")
          .first(),
        "Current User Disabled Admin Action",
      ),
      adminActiveTimeframeChips: this.withDescription(
        this.locate("timeframe-defaults-section")
          .locator('[data-testid^="timeframe-chip-"][data-active="true"]'),
        "Admin Active Timeframe Chips",
      ),
      adminFirstActiveTimeframeChip: this.withDescription(
        this.locate("timeframe-defaults-section")
          .locator('[data-testid^="timeframe-chip-"][data-active="true"]')
          .first(),
        "First Admin Active Timeframe Chip",
      ),
      timeframeCustomizeRows: this.withDescription(
        this.locate("timeframe-customize-popover")
          .locator('[data-testid^="timeframe-customize-row-"]'),
        "Timeframe Customize Rows",
      ),
      adminMetadataEnrichmentModeSelect: this.locate(
        "admin-settings-metadata-enrichment-mode-select",
        "Admin Metadata Enrichment Mode Select",
      ),
      adminMetadataEnrichmentModeSave: this.locate(
        "admin-settings-metadata-enrichment-mode-save",
        "Admin Metadata Enrichment Mode Save Button",
      ),
      adminMetadataEnrichmentModeEffective: this.locate(
        "admin-settings-metadata-enrichment-mode-effective",
        "Admin Metadata Enrichment Mode Effective Value",
      ),
    };
  }
}
