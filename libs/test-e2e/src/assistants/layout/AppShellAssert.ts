import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";

export class AppShellAssert extends BaseAssert {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async topBarTitleContains(text: string): Promise<void> {
    await expect(this.el.topBar.elements.title).toContainText(text);
  }

  @Step()
  async isOnRoute(expected: string | RegExp): Promise<void> {
    await this.mxAssertUrlMatches(expected);
  }

  @Step()
  async quotePollValueContains(text: string): Promise<void> {
    await expect(this.el.settings.quotePollValue).toContainText(text);
  }

  @Step()
  async desktopSidebarIsVisible(): Promise<void> {
    await expect(this.el.desktopSidebar).toBeVisible();
  }

  @Step()
  async desktopSidebarCollapsedStateIs(collapsed: boolean): Promise<void> {
    await expect(this.el.desktopSidebar).toHaveAttribute("data-collapsed", String(collapsed));
  }

  @Step()
  async desktopNavToggleIsVisible(): Promise<void> {
    await expect(this.el.desktopNavToggle).toBeVisible();
  }

  @Step()
  async sidebarLinkIsCurrent(destination: string, mode: "desktop" | "mobile" = "desktop"): Promise<void> {
    const container = mode === "desktop" ? this.el.desktopSidebar : this.el.mobileSidebar;
    await expect(container.getByTestId(`sidebar-link-${destination}`)).toHaveAttribute("aria-current", "page");
  }

  @Step()
  async desktopSearchIsVisible(): Promise<void> {
    await expect(this.el.search.elements.desktopSearch).toBeVisible();
  }

  @Step()
  async desktopSearchPaddingLeftAtLeast(expectedMinimum: number): Promise<void> {
    const paddingLeft = await this.el.search.elements.desktopSearch.evaluate(
      (input) => Number.parseFloat(getComputedStyle(input).paddingLeft),
    );
    await this.mxAssertGreaterThanOrEqual(paddingLeft, expectedMinimum, "desktop search left padding");
  }

  @Step()
  async searchResultsAreVisible(): Promise<void> {
    await expect(this.el.search.elements.desktopResults).toBeVisible();
  }

  @Step()
  async quickSearchTickerIsVisible(symbol: string): Promise<void> {
    await expect(this.el.search.elements.desktopResults.getByRole("button", { name: new RegExp(symbol) })).toBeVisible();
  }

  @Step()
  async mobileNavToggleIsVisible(): Promise<void> {
    await expect(this.el.mobileNavToggle).toBeVisible();
  }

  @Step()
  async mobileSearchButtonIsVisible(): Promise<void> {
    await expect(this.el.search.elements.mobileSearchButton).toBeVisible();
  }

  @Step()
  async mobileSearchSheetIsVisible(): Promise<void> {
    await expect(this.el.search.elements.mobileSheet).toBeVisible();
  }

  @Step()
  async documentHasNoHorizontalOverflow(tolerance = 2): Promise<void> {
    const { scrollWidth, clientWidth } = await this.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await this.mxAssertLessThanOrEqual(scrollWidth, clientWidth + tolerance, "document scroll width");
  }

  @Step()
  async avatarButtonIsFocused(): Promise<void> {
    await expect(this.el.topBar.elements.avatarButton).toBeFocused();
  }

  @Step()
  async appIsReady(): Promise<void> {
    await expect(this.el.appReady).toBeAttached({ timeout: 30_000 });
  }

  @Step()
  async avatarMenuShowsSettingsAndSignOut(): Promise<void> {
    await expect(this.el.topBar.elements.avatarMenuSettings).toBeVisible();
    await expect(this.el.topBar.elements.avatarMenuSignOut).toBeVisible();
  }

  @Step()
  async avatarIdentityContains(text: string | RegExp): Promise<void> {
    await expect(this.el.topBar.elements.avatarMenuIdentity).toContainText(text);
  }

  @Step()
  async avatarImageSourceContains(text: string): Promise<void> {
    const image = this.el.topBar.elements.avatarButton.locator("img");
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toContain(text);
  }

  @Step()
  async avatarShowsNoImage(): Promise<void> {
    await expect(this.el.topBar.elements.avatarButton.locator("img")).toHaveCount(0);
  }

  @Step()
  async avatarInitialsMatch(expected: RegExp): Promise<void> {
    await expect(
      this.el.topBar.elements.avatarButton.locator("span[aria-hidden='true']"),
    ).toHaveText(expected);
  }
}
