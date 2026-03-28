import type { Constructor } from "@tw-portfolio/test-framework/core";

/** Symmetric with ArrangeMixin/AssertMixin — extend when shared action behavior emerges. */
export function ApiActionsMixin<TBase extends Constructor<object>>(Base: TBase) {
  return class extends Base {};
}

/** Build request headers that authenticate via a raw cookie string. */
export function headersForCookie(cookie: string): Record<string, string> {
  return { cookie };
}
