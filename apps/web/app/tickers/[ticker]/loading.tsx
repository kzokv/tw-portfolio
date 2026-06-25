import { cookies } from "next/headers";
import { RouteLoadingState } from "../../../components/layout/RouteLoadingState";
import { getDictionary } from "../../../lib/i18n";
import { LOCALE_OVERRIDE_COOKIE, normalizeLocaleOverride } from "../../../lib/i18n/localeOverrideCookie";

export default async function Loading() {
  const cookieStore = await cookies();
  const locale = normalizeLocaleOverride(cookieStore.get(LOCALE_OVERRIDE_COOKIE)?.value) ?? "en";
  const dict = getDictionary(locale);
  return (
    <RouteLoadingState
      eyebrow={dict.commandPalette.groupTickers}
      title={locale === "zh-TW" ? "載入代號明細中" : "Loading ticker detail"}
      body={
        locale === "zh-TW"
          ? "正在準備價格歷史、基本資料，以及你目前的持倉情境。"
          : "Preparing price history, fundamentals, and your current position context."
      }
    />
  );
}
