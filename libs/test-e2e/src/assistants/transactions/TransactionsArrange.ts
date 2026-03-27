import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

export class TransactionsArrange extends BaseArrange {
  declare protected readonly _instance: TransactionsPage;
}
