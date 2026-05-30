import { ApiBaseArrange } from "../../mixins/index.js";
import type { TransactionsEndpoint } from "../../endpoints/TransactionsEndpoint.js";

/** Stub — extend with domain-specific arrange helpers as transaction test scenarios grow. */
export class TransactionsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: TransactionsEndpoint;
}
