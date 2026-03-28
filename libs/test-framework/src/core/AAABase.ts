import type { APIRequestContext } from "@playwright/test";
import type { TTestAAAOptions } from "./types.js";

export class AAABase<TInstance = unknown> {
  protected readonly _instance: TInstance;
  readonly request: APIRequestContext;
  readonly role: string | undefined;
  readonly testUser: unknown;
  readonly userId: string | undefined;

  constructor(options: TTestAAAOptions<TInstance>) {
    this._instance = options.instance;
    this.request = options.request;
    this.role = options.role;
    this.testUser = options.testUser;
    this.userId = options.userId;
  }
}
