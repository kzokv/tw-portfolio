import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

export interface TLoginElements {
  googleSignInButton: Locator;
  demoSignInButton: Locator;
  errorAlert: Locator;
  demoExpiredMessage: Locator;
}

export class LoginPage extends BasePage<TLoginElements> {
  protected initializeElements(): void {
    this._elements = {
      googleSignInButton: this.locate("google-sign-in-button", "Google Sign In Button"),
      demoSignInButton: this.locate("demo-sign-in-button", "Demo Sign In Button"),
      errorAlert: this.withDescription(
        this.page.locator("main [role='alert']"),
        "Login Error Alert",
      ),
      demoExpiredMessage: this.withDescription(
        this.page.getByText("Your demo session has ended"),
        "Demo Expired Message",
      ),
    };
  }
}
