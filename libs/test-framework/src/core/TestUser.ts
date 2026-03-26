import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

import { appInjectAssistantRegistry, webAssistantRegistry } from "../config/mapper.js";
import type { BasePage } from "./BasePage.js";

import type { Constructor, TAssistantFactoryOptions, TUIActions } from "./types.js";

const E2E_USER_COOKIE = "tw_e2e_user";

export interface TTestUserOptions {
  displayName?: string;
  page?: Page;
  request: APIRequestContext;
  role?: string;
  uiActions?: TUIActions;
  userId: string;
}

export class TestUser {
  readonly userId: string;
  readonly displayName: string | undefined;
  readonly sessionId: string;
  readonly page: Page | undefined;
  readonly request: APIRequestContext;
  readonly role: string | undefined;

  private readonly assistantCache = new Map<Constructor<unknown>, unknown>();
  private readonly notes = new Map<string, unknown>();
  private readonly uiActions: TUIActions | undefined;

  constructor(options: TTestUserOptions) {
    this.userId = options.userId;
    this.displayName = options.displayName;
    this.sessionId = randomUUID();
    this.page = options.page;
    this.request = options.request;
    this.role = options.role;
    this.uiActions = options.uiActions;
  }

  async reset(apiBaseUrl: string): Promise<void> {
    const response = await this.request.post(new URL("/__e2e/reset", apiBaseUrl).href, {
      headers: { "x-user-id": this.userId },
    });

    if (!response.ok()) {
      throw new Error(`Failed to reset E2E user ${this.userId}: ${response.status()} ${response.statusText()}`);
    }
  }

  async assignIdentity(appBaseUrl: string): Promise<void> {
    if (!this.page) {
      throw new Error("assignIdentity requires a Playwright page");
    }

    await this.page.context().clearCookies();
    await this.page.context().addCookies([
      {
        name: E2E_USER_COOKIE,
        value: encodeURIComponent(this.userId),
        url: new URL("/", appBaseUrl).href,
      },
    ]);
  }

  async useWebAssistant<TPage extends BasePage<unknown>, TAssistant>(
    PageClass: Constructor<TPage>,
  ): Promise<TAssistant> {
    if (!this.page) {
      throw new Error("useWebAssistant requires a Playwright page");
    }

    const cached = this.assistantCache.get(PageClass) as TAssistant | undefined;
    if (cached) {
      return cached;
    }

    const instance = new PageClass(this.page);
    const assistant = await webAssistantRegistry.create(PageClass, this.createFactoryOptions(instance));
    this.assistantCache.set(PageClass, assistant);
    return assistant as TAssistant;
  }

  async useAppInjectAssistant<TService, TAssistant>(
    ServiceClass: Constructor<TService>,
    app: unknown,
  ): Promise<TAssistant> {
    const cached = this.assistantCache.get(ServiceClass) as TAssistant | undefined;
    if (cached) {
      return cached;
    }

    const instance = new ServiceClass({
      app,
      request: this.request,
      role: this.role,
      userId: this.userId,
    });

    const assistant = await appInjectAssistantRegistry.create(
      ServiceClass,
      this.createFactoryOptions(instance, { app }),
    );
    this.assistantCache.set(ServiceClass, assistant);
    return assistant as TAssistant;
  }

  appendNote<T>(key: string, values: T[]): void {
    const existing = (this.notes.get(key) as T[] | undefined) ?? [];
    this.notes.set(key, [...existing, ...values]);
  }

  getNote<T>(key: string): T | undefined {
    return this.notes.get(key) as T | undefined;
  }

  private createFactoryOptions<TInstance>(
    instance: TInstance,
    extra: Partial<TAssistantFactoryOptions<TInstance>> = {},
  ): TAssistantFactoryOptions<TInstance> {
    const options: TAssistantFactoryOptions<TInstance> = {
      instance,
      request: this.request,
      testUser: this,
    };

    if (this.page) {
      options.page = this.page;
    }
    if (this.role) {
      options.role = this.role;
    }
    if (this.uiActions) {
      options.uiActions = this.uiActions;
    }

    options.userId = this.userId;

    return {
      ...options,
      ...extra,
    };
  }
}
