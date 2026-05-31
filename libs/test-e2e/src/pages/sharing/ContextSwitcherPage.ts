import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

export interface TContextSwitcherElements {
  switcherRoot: Locator;
  dropdown: Locator;
  optionSelf: Locator;
  readonlyBadge: Locator;
  eyebrow: Locator;
  manageSharingLink: Locator;
  dataReady: Locator;
}

export class ContextSwitcherPage extends BasePage<TContextSwitcherElements> {
  protected initializeElements(): void {
    // Phase 3c: PortfolioSwitcher moved from TopBar into the sidebar header.
    // The wrapper testid `topbar-portfolio-switcher-slot` is renamed to
    // `app-sidebar-portfolio-switcher-slot` (per architect-design.md §2).
    const desktopSlot = this.page.getByTestId("app-sidebar-portfolio-switcher-slot");
    this._elements = {
      switcherRoot: desktopSlot.getByTestId("portfolio-switcher"),
      dropdown: this.locate("portfolio-switcher-dropdown", "Portfolio context switcher dropdown"),
      optionSelf: this.locate("portfolio-switcher-option-self", "My Portfolio option"),
      readonlyBadge: desktopSlot.getByTestId("portfolio-switcher-badge-readonly"),
      eyebrow: desktopSlot.getByTestId("portfolio-switcher-eyebrow"),
      manageSharingLink: this.locate("portfolio-switcher-manage-sharing", "Manage sharing footer link"),
      // Attached once AppShell's inbound-shares fetch has resolved (pass or
      // fail). Assertions that expect the switcher to appear must wait for
      // this marker first — otherwise they race the client-side fetch and
      // can time out before shares load on slow CI runners.
      dataReady: this.locate("switcher-data-ready", "Switcher data ready marker"),
    };
  }

  /** Locator for a per-owner dropdown option. */
  optionForOwner(ownerUserId: string): Locator {
    return this.page.getByTestId(`portfolio-switcher-option-${ownerUserId}`);
  }
}
