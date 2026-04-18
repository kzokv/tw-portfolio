import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TContextSwitcherElements {
  switcherRoot: Locator;
  dropdown: Locator;
  optionSelf: Locator;
  readonlyBadge: Locator;
  eyebrow: Locator;
  manageSharingLink: Locator;
}

export class ContextSwitcherPage extends BasePage<TContextSwitcherElements> {
  protected initializeElements(): void {
    const desktopSlot = this.page.getByTestId("topbar-portfolio-switcher-slot");
    this._elements = {
      switcherRoot: desktopSlot.getByTestId("portfolio-switcher"),
      dropdown: this.locate("portfolio-switcher-dropdown", "Portfolio context switcher dropdown"),
      optionSelf: this.locate("portfolio-switcher-option-self", "My Portfolio option"),
      readonlyBadge: desktopSlot.getByTestId("portfolio-switcher-badge-readonly"),
      eyebrow: desktopSlot.getByTestId("portfolio-switcher-eyebrow"),
      manageSharingLink: this.locate("portfolio-switcher-manage-sharing", "Manage sharing footer link"),
    };
  }

  /** Locator for a per-owner dropdown option. */
  optionForOwner(ownerUserId: string): Locator {
    return this.page.getByTestId(`portfolio-switcher-option-${ownerUserId}`);
  }
}
