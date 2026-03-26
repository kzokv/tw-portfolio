import { Step } from "../decorators/Step.js";
import type { APIRequestContext } from "@playwright/test";

import type { Constructor } from "../core/types.js";

import { CoreMixin } from "./CoreMixin.js";

export function ArrangeMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends CoreMixin(Base) {
    @Step("Seed Data")
    async mxSeedData(apiBaseUrl: string): Promise<void> {
      const actor = this as unknown as {
        request: APIRequestContext;
        userId?: string;
      };

      if (!actor.userId) {
        throw new Error("mxSeedData requires a userId");
      }

      const response = await actor.request.post(new URL("/__e2e/reset", apiBaseUrl).href, {
        headers: {
          "x-user-id": actor.userId,
        },
      });

      if (!response.ok()) {
        throw new Error(`Seed data failed: ${response.status()} ${response.statusText()}`);
      }
    }
  };
}
