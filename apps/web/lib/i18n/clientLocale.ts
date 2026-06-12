import type { LocaleCode } from "@vakwen/shared-types";

export function resolveClientLocale(): LocaleCode {
  if (typeof document !== "undefined" && document.documentElement.lang === "zh-TW") {
    return "zh-TW";
  }

  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")) {
    return "zh-TW";
  }

  return "en";
}
