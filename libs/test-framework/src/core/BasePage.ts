import type { Locator, Page } from "@playwright/test";

import type { TLocatorWithDescribe } from "./types.js";

type TRole = Parameters<Page["getByRole"]>[0];
type TLocateByRoleOptions = NonNullable<Parameters<Page["getByRole"]>[1]> & {
  description?: string;
};

export abstract class BasePage<TElements> {
  readonly page: Page;
  protected _elements!: TElements;

  constructor(page: Page) {
    this.page = page;
    this.initializeElements();
  }

  get elements(): TElements {
    return this._elements;
  }

  protected locate(testId: string, description?: string): Locator {
    return this.withDescription(this.page.getByTestId(testId), description);
  }

  protected locateByRole(role: TRole, options: TLocateByRoleOptions = {}): Locator {
    const { description, ...roleOptions } = options;
    return this.withDescription(this.page.getByRole(role, roleOptions), description);
  }

  protected withDescription(locator: Locator, description?: string): Locator {
    if (!description) {
      return locator;
    }

    const describedLocator = locator as TLocatorWithDescribe;
    if (typeof describedLocator.describe === "function") {
      return describedLocator.describe(description);
    }

    return locator;
  }

  protected abstract initializeElements(): void;
}
