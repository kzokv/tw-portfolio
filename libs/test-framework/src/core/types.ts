import type {
  BrowserContext,
  APIRequestContext,
  Locator,
  Page,
  Response,
} from "@playwright/test";

// TypeScript mixins require the broad constructor signature here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T> = new (...args: any[]) => T;

export interface TActionLogger {
  info(message: string): void;
  warn(message: string): void;
  pushError(error: string): void;
  drainErrors(): string[];
  logDrainedErrors(duringAction: string): void;
}

export interface TClickAction {
  perform(locator: Locator, options?: Parameters<Locator["click"]>[0]): Promise<void>;
}

export interface TFillActionOptions extends NonNullable<Parameters<Locator["fill"]>[1]> {
  sensitive?: boolean;
}

export interface TFillAction {
  perform(locator: Locator, value: string, options?: TFillActionOptions): Promise<void>;
}

export interface THoverAction {
  perform(locator: Locator, options?: Parameters<Locator["hover"]>[0]): Promise<void>;
}

export interface TKeyboardPressAction {
  perform(page: Page, key: string, options?: Parameters<Page["keyboard"]["press"]>[1]): Promise<void>;
}

export interface TSelectAction {
  perform(
    locator: Locator,
    values: Parameters<Locator["selectOption"]>[0],
  ): Promise<void>;
}

export interface TWaitForVisibleOptions {
  timeout?: number;
}

export interface TWaitForVisibleAction {
  perform(locator: Locator, options?: TWaitForVisibleOptions): Promise<void>;
}

export interface TUIActions {
  click: TClickAction;
  fill: TFillAction;
  hover: THoverAction;
  keyboardPress: TKeyboardPressAction;
  select: TSelectAction;
  wait: TWaitForVisibleAction;
}

export type TBrowserCookie = Parameters<BrowserContext["addCookies"]>[0][number];

export interface TElementLocatorHelpers {
  css: (selector: string, description?: string) => Locator;
  testId: (testId: string, description?: string) => Locator;
  text: (text: string | RegExp, description?: string) => Locator;
}

export interface TTestAAAOptions<TInstance = unknown> {
  instance: TInstance;
  request: APIRequestContext;
  page?: Page;
  role?: string;
  testUser?: unknown;
  uiActions?: TUIActions;
  userId?: string;
}

export interface TAssistantFactoryOptions<TInstance = unknown> extends TTestAAAOptions<TInstance> {
  app?: unknown;
}

export type TApiBaseOptions<TInstance = unknown> = TTestAAAOptions<TInstance>;

export type TAssistantFactory<TInstance, TAssistant> = (
  options: TAssistantFactoryOptions<TInstance>,
) => TAssistant | Promise<TAssistant>;

export type TResponsePredicate = (response: Response) => boolean | Promise<boolean>;

export type TLocatorWithDescribe = Locator & {
  describe: (description: string) => Locator;
  description?: () => string;
};
