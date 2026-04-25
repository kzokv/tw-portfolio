import { Step } from "../decorators/Step.js";
import type { Locator, Page } from "@playwright/test";

import type { Constructor, TBrowserCookie, TResponsePredicate, TUIActions } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ActionsMixin<TBase extends Constructor<{ page: Page; uiActions: TUIActions }>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Set Viewport Size")
    async mxSetViewportSize(width: number, height: number): Promise<void> {
      await this.page.setViewportSize({ width, height });
    }

    @Step("Go To Url")
    async mxGotoUrl(url: string): Promise<void> {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
    }

    @Step("Navigate To Route")
    async mxNavigateToRoute(path: string, appBaseUrl?: string): Promise<void> {
      const destination = appBaseUrl ? new URL(path, appBaseUrl).href : path;
      await this.page.goto(destination, { waitUntil: "domcontentloaded" });
      await this.mxWaitForAppReady();
    }

    @Step("Reload Page")
    async mxReloadPage(options: { waitForReady?: boolean } = {}): Promise<void> {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      if (options.waitForReady !== false) {
        await this.mxWaitForAppReady();
      }
    }

    @Step("Click Locator")
    async mxClick(locator: Locator, options?: Parameters<Locator["click"]>[0]): Promise<void> {
      await this.uiActions.click.perform(locator, options);
    }

    @Step("Hover Locator")
    async mxHover(locator: Locator): Promise<void> {
      await this.uiActions.hover.perform(locator);
    }

    @Step("Fill Locator")
    async mxFill(locator: Locator, value: string): Promise<void> {
      await this.uiActions.fill.perform(locator, value);
    }

    @Step("Focus Locator")
    async mxFocus(locator: Locator): Promise<void> {
      await locator.focus();
    }

    @Step("Check Locator")
    async mxCheck(locator: Locator): Promise<void> {
      await locator.check();
    }

    @Step("Uncheck Locator")
    async mxUncheck(locator: Locator): Promise<void> {
      await locator.uncheck();
    }

    @Step("Drag Locator")
    async mxDragTo(source: Locator, target: Locator): Promise<void> {
      await source.dragTo(target);
    }

    @Step("Press Keyboard Key")
    async mxPressKey(key: string): Promise<void> {
      await this.uiActions.keyboardPress.perform(this.page, key);
    }

    @Step("Move Mouse")
    async mxMoveMouse(x: number, y: number): Promise<void> {
      await this.page.mouse.move(x, y);
    }

    @Step("Select Option")
    async mxSelectOption(locator: Locator, value: Parameters<Locator["selectOption"]>[0]): Promise<void> {
      await this.uiActions.select.perform(locator, value);
    }

    @Step("Add Cookies")
    async mxAddCookies(cookies: TBrowserCookie[]): Promise<void> {
      await this.page.context().addCookies(cookies);
    }

    @Step("Clear Cookie")
    async mxClearCookie(name: string): Promise<void> {
      await this.page.context().clearCookies({ name });
    }

    @Step("Clear Cookies")
    async mxClearCookies(): Promise<void> {
      await this.page.context().clearCookies();
    }

    /**
     * Wait for a response matching `predicate`.
     *
     * Two valid call patterns:
     *
     * 1. **Interleaved** — pass an `action` callback as the second arg. The
     *    listener is attached, then the action fires, then the response is
     *    awaited. Preferred when readable.
     *      `await this.mxWaitForResponse(pred, () => this.uiActions.click.perform(el));`
     *
     * 2. **Pre-attach** — call without an action, capture the returned promise,
     *    fire the trigger, then await the captured promise.
     *      `const p = this.mxWaitForResponse(pred);`
     *      `await this.uiActions.click.perform(el);`
     *      `return p;`
     *
     * **CONTRACT (load-bearing for Pattern 2):** `this.page.waitForResponse(predicate)`
     * MUST be called synchronously before this function suspends on any
     * `await`. Playwright attaches the response listener at *call* time, not
     * at *await* time — so Pattern 2 only works because no `await` precedes
     * the listener-setup line below when `action` is undefined. If you add a
     * pre-listener `await` here (logging, dynamic timeout resolution, etc.),
     * Pattern 2 becomes a race that loses the response on fast machines. Move
     * any new `await` to AFTER `this.page.waitForResponse(predicate)`.
     */
    @Step("Wait For Response")
    async mxWaitForResponse(
      predicate: TResponsePredicate,
      actionOrOptions?: (() => Promise<unknown>) | { timeout?: number },
      timeout?: number,
    ): Promise<import("@playwright/test").Response> {
      const action = typeof actionOrOptions === "function" ? actionOrOptions : undefined;
      const responseTimeout = typeof actionOrOptions === "function"
        ? timeout
        : actionOrOptions?.timeout ?? timeout;
      // Listener must be attached synchronously — see CONTRACT above.
      const responsePromise =
        responseTimeout === undefined
          ? this.page.waitForResponse(predicate)
          : this.page.waitForResponse(predicate, { timeout: responseTimeout });
      if (action) {
        await action();
      }

      return await responsePromise;
    }
  };
}
