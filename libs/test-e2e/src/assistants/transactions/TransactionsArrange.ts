import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

/** Empty — required by createAssistantFactory's AAA triple. Add page-specific setup here when needed. */
export class TransactionsArrange extends BaseArrange {
  declare protected readonly _instance: TransactionsPage;
}
