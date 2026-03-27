import { expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";
import type { TSidebarDestination } from "../../pages/layout/SideNavigationComponent.js";

export class AppShellActions extends BaseActions {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToRoute(path: string): Promise<void> {
    await this.mxNavigateToRoute(path, TestEnv.appBaseUrl);
  }

  @Step()
  async openSettingsDrawer(): Promise<void> {
    await this.mxWaitForAppReady();
    await this.uiActions.click.perform(this.el.topBar.elements.avatarButton);
    await this.uiActions.wait.perform(this.el.topBar.elements.avatarMenuSettings);
    await this.uiActions.click.perform(this.el.topBar.elements.avatarMenuSettings);
    await this.verifyDrawerOpened();
  }

  private async verifyDrawerOpened(): Promise<void> {
    await expect(this.el.settings.drawer).toBeVisible();
    await expect(this.page).toHaveURL(/drawer=settings/);
  }

  @Step()
  async setViewport(width: number, height: number): Promise<void> {
    await this.mxSetViewportSize(width, height);
  }

  @Step()
  async navigateViaSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.sideNavigation.elements.link(destination));
    await this.mxWaitForAppReady();
  }

  @Step()
  async reloadPage(): Promise<void> {
    await this.mxReloadPage();
  }

  @Step()
  async toggleDesktopSidebar(): Promise<void> {
    await this.uiActions.click.perform(this.el.desktopNavToggle);
  }

  @Step()
  async navigateViaMobileSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileSidebar.getByTestId(`sidebar-link-${destination}`));
    await this.mxWaitForAppReady();
  }

  @Step()
  async openMobileNavigation(): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileNavToggle);
    await this.uiActions.wait.perform(this.el.mobileSidebar);
  }

  @Step()
  async fillDesktopSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.elements.desktopSearch, value);
  }

  @Step()
  async openMobileSearch(): Promise<void> {
    await this.uiActions.click.perform(this.el.search.elements.mobileSearchButton);
    await this.uiActions.wait.perform(this.el.search.elements.mobileSheet);
  }

  @Step()
  async fillMobileSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.elements.mobileSheetInput, value);
  }

  @Step()
  async clickQuickSearchRoute(route: string, panel: "desktop" | "mobile" = "desktop"): Promise<void> {
    const container = panel === "desktop"
      ? this.el.search.elements.desktopResults
      : this.el.search.elements.mobileResults;
    await this.uiActions.click.perform(container.getByTestId(`quick-search-item-route-${route}`));
  }

  @Step()
  async clickQuickSearchSymbol(symbol: string): Promise<void> {
    await this.uiActions.click.perform(this.el.search.elements.desktopResults.getByRole("button", { name: new RegExp(symbol) }));
  }

  @Step()
  async openAvatarMenu(): Promise<void> {
    await this.mxWaitForAppReady();
    await this.uiActions.click.perform(this.el.topBar.elements.avatarButton);
  }

  @Step()
  async focusAvatarButton(): Promise<void> {
    await this.el.topBar.elements.avatarButton.focus();
  }

  @Step()
  async clickAvatarMenuSignOut(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.elements.avatarMenuSignOut);
  }
}
