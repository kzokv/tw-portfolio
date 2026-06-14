import type { LocaleCode } from "@vakwen/shared-types";

export const LOCALE_OVERRIDE_COOKIE = "vw_locale_override";
const LOCALE_OVERRIDE_MAX_AGE_SECONDS = 60;

export function normalizeLocaleOverride(value: string | null | undefined): LocaleCode | null {
  if (value === "en" || value === "zh-TW") return value;
  return null;
}

export function writeLocaleOverrideCookie(locale: LocaleCode): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_OVERRIDE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_OVERRIDE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
