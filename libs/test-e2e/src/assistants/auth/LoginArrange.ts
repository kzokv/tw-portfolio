import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";

import type { LoginPage } from "../../pages/auth/LoginPage.js";

export class LoginArrange extends BaseArrange {
  declare protected readonly _instance: LoginPage;

  @Step()
  async stubDemoStartResponse(status: number, error: string): Promise<void> {
    await this.page.route("**/api/demo/start", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error }),
      }));
  }
}
