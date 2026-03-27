import type { APIRequestContext, Page } from "@playwright/test";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ArrangeMixin<TBase extends Constructor<{ page: Page; request: APIRequestContext; userId: string | undefined }>>(Base: TBase) {
  return class extends CoreMixin(Base) {};
}
