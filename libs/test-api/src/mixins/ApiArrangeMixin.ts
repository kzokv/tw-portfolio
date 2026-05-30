import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import type { Constructor } from "@vakwen/test-framework/core";

export function ApiArrangeMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends Base {
    @Step()
    async body(response: APIResponse): Promise<unknown> {
      return await response.json();
    }

    @Step()
    async header(response: APIResponse, headerName: string): Promise<string> {
      return response.headers()[headerName] ?? "";
    }
  };
}
