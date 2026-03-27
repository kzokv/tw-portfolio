import { expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { LoginPage } from "../../pages/auth/LoginPage.js";

export class LoginActions extends AppBaseActions {
  declare protected readonly _instance: LoginPage;

  private get el() {
    return this._instance.elements;
  }

  private async waitForLoginPageReady(): Promise<void> {
    await this.uiActions.wait.perform(this.el.googleSignInButton);
    if (await this.el.demoSignInButton.count() > 0) {
      await this.uiActions.wait.perform(this.el.demoSignInButton);
    }
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
  }

  @Step()
  async navigateToLogin(): Promise<void> {
    await this.page.goto(new URL("/login", TestEnv.appBaseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await this.waitForLoginPageReady();
  }

  @Step()
  async navigateToLoginWithQuery(query: string): Promise<void> {
    await this.page.goto(new URL(`/login${query}`, TestEnv.appBaseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await this.waitForLoginPageReady();
  }

  @Step()
  async clickDemoSignIn(): Promise<void> {
    await this.uiActions.click.perform(this.el.demoSignInButton);
  }

  @Step()
  async clickGoogleSignIn(): Promise<void> {
    await this.uiActions.click.perform(this.el.googleSignInButton);
  }

  @Step()
  async clickGoogleSignInAndCaptureStartNavigation(): Promise<string> {
    const routePattern = "**/auth/google/start**";
    let navigatedUrl = "";
    const handler = async (route: Parameters<typeof this.page.route>[1] extends (route: infer TRoute, ...args: never[]) => unknown ? TRoute : never) => {
      navigatedUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    };

    await this.page.route(routePattern, handler);
    try {
      await this.clickGoogleSignIn();
      await this.page.waitForURL((url) => url.href.includes("/auth/google/start"));
      return navigatedUrl;
    } finally {
      await this.page.unroute(routePattern, handler);
    }
  }

  @Step()
  async waitForDashboard(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  }

  @Step()
  async waitForDemoStartResponse(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse((res) => res.url().includes("/api/demo/start"));
  }
}
