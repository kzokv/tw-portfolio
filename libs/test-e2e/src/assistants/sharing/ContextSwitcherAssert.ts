import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { ContextSwitcherPage } from "../../pages/sharing/ContextSwitcherPage.js";

const CONTEXT_COOKIE_NAME = "tw_context_user_id";

export class ContextSwitcherAssert extends BaseAssert {
  declare protected readonly _instance: ContextSwitcherPage;

  private get el() {
    return this._instance.elements;
  }

  /**
   * Wait for the client-side inbound-shares fetch to resolve before any
   * visibility assertion. Prevents races where the test runs on the first
   * (no-switcher) paint while the shares fetch is still in flight.
   */
  @Step()
  async dataIsReady(): Promise<void> {
    await expect(this.el.dataReady).toBeAttached({ timeout: 30_000 });
  }

  @Step()
  async switcherIsVisible(): Promise<void> {
    await this.dataIsReady();
    await expect(this.el.switcherRoot).toBeVisible();
  }

  @Step()
  async switcherIsHidden(): Promise<void> {
    await this.dataIsReady();
    await expect(this.el.switcherRoot).toHaveCount(0);
  }

  @Step()
  async dropdownIsOpen(): Promise<void> {
    await expect(this.el.dropdown).toBeVisible();
  }

  @Step()
  async dropdownIsClosed(): Promise<void> {
    await expect(this.el.dropdown).toBeHidden();
  }

  @Step()
  async dropdownContainsText(text: string | RegExp): Promise<void> {
    await expect(this.el.dropdown).toContainText(text);
  }

  @Step()
  async optionSelfIsVisible(): Promise<void> {
    await expect(this.el.optionSelf).toBeVisible();
  }

  @Step()
  async ownerOptionIsVisible(ownerUserId: string): Promise<void> {
    await expect(this._instance.optionForOwner(ownerUserId)).toBeVisible();
  }

  @Step()
  async selectedLabelContains(text: string | RegExp): Promise<void> {
    await expect(this.el.switcherRoot).toContainText(text);
  }

  @Step()
  async manageSharingLinkIsVisible(): Promise<void> {
    await expect(this.el.manageSharingLink).toBeVisible();
  }

  /**
   * Switched-in state: rose-tinted selected label + Read-only badge + eyebrow.
   * Pass the visible selected label (owner display name or email).
   */
  @Step()
  async assertSwitchedIn(label: string | RegExp): Promise<void> {
    await this.dataIsReady();
    await this.selectedLabelContains(label);
    await expect(this.el.readonlyBadge).toBeVisible();
    await expect(this.el.eyebrow).toBeVisible();
  }

  /** Switched-out state: self selected, no badge, no eyebrow. */
  @Step()
  async assertSwitchedOut(): Promise<void> {
    await this.dataIsReady();
    await expect(this.el.readonlyBadge).toBeHidden();
    await expect(this.el.eyebrow).toBeHidden();
  }

  /**
   * Verify the persisted context cookie matches the expected owner (or null
   * for "no cookie set"). Reads from the BrowserContext cookie jar via
   * `page.context().cookies()` so we observe what the browser actually has.
   */
  @Step()
  async cookieEquals(expectedOwnerUserId: string | null): Promise<void> {
    await expect
      .poll(async () => {
        const cookies = await this.page.context().cookies();
        const match = cookies.find((c) => c.name === CONTEXT_COOKIE_NAME);
        return match?.value ?? null;
      })
      .toBe(expectedOwnerUserId);
  }
}
