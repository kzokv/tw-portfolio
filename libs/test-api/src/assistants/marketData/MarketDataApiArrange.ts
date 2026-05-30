import { ApiBaseArrange } from "../../mixins/index.js";
import type { MarketDataEndpoint } from "../../endpoints/MarketDataEndpoint.js";

export class MarketDataApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: MarketDataEndpoint;
}
