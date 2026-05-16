import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

// Phase 3c: Breadcrumb component replaces the retired topbar-title H1.
// Per spec §4 locked testid contract:
//   - breadcrumb-root  : root <nav> element
//   - breadcrumb-item-{index} : 0-indexed segments; rightmost has aria-current="page"
export interface TBreadcrumbElements extends TElementLocatorHelpers {
  /** Root <nav aria-label="Breadcrumb"> element. */
  root: Locator;
  /** Get a breadcrumb segment by 0-based index. */
  item: (index: number) => Locator;
  /** The rightmost segment (aria-current="page"). Convenience accessor. */
  currentItem: Locator;
}

export class BreadcrumbPage extends BasePage<TBreadcrumbElements> {
  protected initializeElements(): void {
    const root = this.locate("breadcrumb-root", "Breadcrumb Root");

    this._elements = {
      ...this.locatorHelpers(),
      root,
      item: (index: number) =>
        this.withDescription(
          this.locate(`breadcrumb-item-${index}`, `Breadcrumb Item ${index}`),
          `Breadcrumb Item ${index}`,
        ),
      currentItem: this.withDescription(
        root.locator('[aria-current="page"]'),
        "Breadcrumb Current Page Item",
      ),
    };
  }
}
