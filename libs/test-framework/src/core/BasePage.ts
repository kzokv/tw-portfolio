import type { Locator, Page } from "@playwright/test";

import type { TElementLocatorHelpers, TLocatorWithDescribe } from "./types.js";

type TRole = Parameters<Page["getByRole"]>[0];
type TLocateByRoleOptions = NonNullable<Parameters<Page["getByRole"]>[1]> & {
  description?: string;
};
type TScope = Page | Locator;

export abstract class BasePage<TElements, TOptions = Record<string, never>> {
  readonly page: Page;
  protected readonly scope: TScope;
  protected readonly options: TOptions;
  protected _elements!: TElements;

  constructor(scope: TScope, options?: TOptions) {
    this.scope = scope;
    this.page = "context" in scope ? scope : scope.page();
    this.options = options ?? ({} as TOptions);
    this.initializeElements();
  }

  get elements(): TElements {
    return this._elements;
  }

  protected locate(testId: string, description?: string): Locator {
    return this.withDescription(this.scope.getByTestId(testId), description);
  }

  protected locateByRole(role: TRole, options: TLocateByRoleOptions = {}): Locator {
    const { description, ...roleOptions } = options;
    return this.withDescription(this.scope.getByRole(role, roleOptions), description);
  }

  protected within(parent: Locator, testId: string, description?: string): Locator {
    return this.withDescription(parent.getByTestId(testId), description);
  }

  protected withinByCss(parent: Locator, css: string, description?: string): Locator {
    return this.withDescription(parent.locator(css), description);
  }

  protected withinByRole(
    parent: Locator,
    role: TRole,
    options: TLocateByRoleOptions = {},
  ): Locator {
    const { description, ...roleOptions } = options;
    return this.withDescription(parent.getByRole(role, roleOptions), description);
  }

  protected nth(parent: Locator, css: string, index: number, description?: string): Locator {
    return this.withDescription(parent.locator(css).nth(index), description);
  }

  protected locatorHelpers(): TElementLocatorHelpers {
    return {
      css: (selector: string, description?: string) =>
        this.withDescription(this.scope.locator(selector), description),
      testId: (testId: string, description?: string) =>
        this.locate(testId, description ?? testId),
      text: (text: string | RegExp, description?: string) =>
        this.withDescription(this.scope.getByText(text), description),
    };
  }

  protected withDescription(locator: Locator, description?: string): Locator {
    if (!description) {
      return locator;
    }

    return (locator as TLocatorWithDescribe).describe(description);
  }

  protected abstract initializeElements(): void;
}
