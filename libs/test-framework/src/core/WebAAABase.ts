import type { Page } from "@playwright/test";
import { defaultUIActions } from "../actions/index.js";
import type { BasePage } from "./BasePage.js";
import type { TTestAAAOptions, TUIActions } from "./types.js";
import { AAABase } from "./AAABase.js";

export class WebAAABase<
  TInstance extends BasePage<unknown> = BasePage<unknown>,
> extends AAABase<TInstance> {
  readonly page: Page;
  readonly uiActions: TUIActions;

  constructor(options: TTestAAAOptions<TInstance>) {
    super(options);
    const page = options.page ?? (this._instance as BasePage<unknown>)?.page;
    if (!page) {
      throw new Error("WebAAABase requires a Playwright Page — provide options.page or a BasePage instance");
    }
    this.page = page;
    this.uiActions = options.uiActions ?? defaultUIActions;
  }
}
