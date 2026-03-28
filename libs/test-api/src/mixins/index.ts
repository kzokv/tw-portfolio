import { ApiAAABase } from "@tw-portfolio/test-framework/core";

export { ApiArrangeMixin } from "./ApiArrangeMixin.js";
export { ApiActionsMixin, headersForCookie } from "./ApiActionsMixin.js";
export { ApiAssertMixin } from "./ApiAssertMixin.js";

import { ApiArrangeMixin } from "./ApiArrangeMixin.js";
import { ApiActionsMixin } from "./ApiActionsMixin.js";
import { ApiAssertMixin } from "./ApiAssertMixin.js";

export const ApiBaseArrange = ApiArrangeMixin(ApiAAABase);
export const ApiBaseActions = ApiActionsMixin(ApiAAABase);
export const ApiBaseAssert = ApiAssertMixin(ApiAAABase);
