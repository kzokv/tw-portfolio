import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";

import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

export class TransactionsArrange extends BaseArrange {
  declare protected readonly _instance: TransactionsPage;

  @Step()
  async stubTransactionEstimateFailure(): Promise<void> {
    await this.page.route("**/portfolio/transactions/estimate", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "estimate_unavailable",
          error: "estimate_unavailable",
          message: "Estimate temporarily unavailable",
        }),
      }));
  }
}
