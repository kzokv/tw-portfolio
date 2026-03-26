import type { APIRequestContext, Page } from "@playwright/test";

import { defaultUIActions } from "../actions/index.js";
import type { BasePage } from "./BasePage.js";

import type { TTestAAAOptions, TUIActions } from "./types.js";

export class TestAAA {
  protected readonly _instance: BasePage<unknown>;
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly role: string | undefined;
  readonly testUser: unknown;
  readonly uiActions: TUIActions;
  readonly userId: string | undefined;

  constructor(options: TTestAAAOptions) {
    const instance = options.instance as BasePage<unknown>;
    this._instance = instance;
    this.page = options.page ?? instance.page;
    this.request = options.request;
    this.role = options.role;
    this.testUser = options.testUser;
    this.uiActions = options.uiActions ?? defaultUIActions;
    this.userId = options.userId;
  }
}
