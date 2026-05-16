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
  /** Brand link / mobile Sheet trigger. Phase 3c: was mobile-nav-toggle. */
  mobileNavToggle: Locator;
  /** Mobile sidebar container (app-sidebar in Sheet context). Phase 3c rename. */
  mobileSidebar: Locator;
  /** App sidebar root. Phase 3c: was desktop-sidebar → app-sidebar. */
  desktopSidebar: Locator;
  /** Sidebar collapse trigger. Phase 3c: was desktop-nav-toggle → app-sidebar-trigger. */
  desktopNavToggle: Locator;
  /** Admin warning rail — only rendered when AppSidebar variant="admin". Phase 3c. */
  appSidebarRail: Locator;
  /** Breadcrumb root <nav>. Phase 3c: replaces retired topbar-title H1. */
  breadcrumbRoot: Locator;
  /** Rightmost breadcrumb segment carrying aria-current="page". */
  breadcrumbCurrentItem: Locator;
  /** A breadcrumb segment by 0-based index. */
  breadcrumbItem: (index: number) => Locator;
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
  htmlRoot: Locator;
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
      // 3c: mobile-nav-toggle → app-sidebar-brand (composite: link on ≥md, Sheet trigger on <md)
      mobileNavToggle: this.locate("app-sidebar-brand", "App Sidebar Brand / Mobile Nav Trigger"),
      // 3c: on mobile the sidebar Sheet uses the same app-sidebar testid
      mobileSidebar: this.locate("app-sidebar", "App Sidebar (mobile Sheet context)"),
      // 3c: desktop-sidebar → app-sidebar (shadcn Sidebar root)
      desktopSidebar: this.locate("app-sidebar", "App Sidebar"),
      // 3c: desktop-nav-toggle → app-sidebar-trigger (shadcn collapse ‹ button)
      desktopNavToggle: this.locate("app-sidebar-trigger", "App Sidebar Trigger"),
      // 3c: admin warning rail — only present on admin variant
      appSidebarRail: this.locate("app-sidebar-rail", "App Sidebar Rail (admin only)"),
      // 3c: breadcrumb root replaces the retired topbar-title H1
      breadcrumbRoot: this.locate("breadcrumb-root", "Breadcrumb Root"),
      breadcrumbCurrentItem: this.withDescription(
        this.locate("breadcrumb-root").locator('[aria-current="page"]'),
        "Breadcrumb Current Page Item",
      ),
      breadcrumbItem: (index: number) =>
        this.withDescription(
          this.locate(`breadcrumb-item-${index}`, `Breadcrumb Item ${index}`),
          `Breadcrumb Item ${index}`,
        ),
      settings: {
        drawer: this.locate("settings-drawer", "Settings Drawer"),
        localeValue: this.locate("settings-locale-value", "Locale Summary Value"),
        costBasisValue: this.locate("settings-cost-basis-value", "Cost Basis Summary Value"),
        quotePollValue: this.locate("settings-quote-poll-value", "Quote Poll Summary Value"),
      },
      // 3c: avatar-button → topbar-profile-menu-trigger
      avatarImage: this.withinByCss(this.locate("topbar-profile-menu-trigger"), "img", "Avatar Image"),
      avatarInitials: this.withinByCss(
        this.locate("topbar-profile-menu-trigger"),
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
      htmlRoot: this.withDescription(this.page.locator("html"), "HTML Root Element"),
    };
  }
}
