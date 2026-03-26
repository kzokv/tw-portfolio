import { expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";
import type { TSidebarDestination } from "../../pages/layout/SideNavigationComponent.js";

export class AppShellActions extends BaseActions {
  private get el() {
    return (this._instance as AppShellPage).elements;
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
  async navigateViaSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.sideNavigation.elements.link(destination));
    await this.mxWaitForAppReady();
  }

  @Step()
  async reloadPage(): Promise<void> {
    await this.mxReloadPage();
  }
}
