import { ApiBaseArrange } from "../../mixins/index.js";
import type { QuotesEndpoint } from "../../endpoints/QuotesEndpoint.js";

export class QuotesApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: QuotesEndpoint;
}
