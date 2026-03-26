import type { APIRequestContext, Page } from "@playwright/test";

import { defaultUIActions } from "../actions/index.js";
import type { BasePage } from "./BasePage.js";

import type { TTestAAAOptions, TUIActions } from "./types.js";

export class TestAAA<TInstance extends BasePage<unknown> = BasePage<unknown>> {
  protected readonly _instance: TInstance;
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly role: string | undefined;
  readonly testUser: unknown;
  readonly uiActions: TUIActions;
  readonly userId: string | undefined;

  constructor(options: TTestAAAOptions) {
    const instance = options.instance as TInstance;
    this._instance = instance;
    this.page = options.page ?? (instance as BasePage<unknown>).page;
    this.request = options.request;
    this.role = options.role;
    this.testUser = options.testUser;
    this.uiActions = options.uiActions ?? defaultUIActions;
    this.userId = options.userId;
  }
}
