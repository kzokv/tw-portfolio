import { ApiBaseAssert } from "../../mixins/index.js";
import type { AdminEndpoint } from "../../endpoints/AdminEndpoint.js";

export class AdminApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: AdminEndpoint;
}
