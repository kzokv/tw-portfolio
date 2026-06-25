import { cookies } from "next/headers";
import { RouteLoadingState } from "../../components/layout/RouteLoadingState";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { LOCALE_OVERRIDE_COOKIE, normalizeLocaleOverride } from "../../lib/i18n/localeOverrideCookie";

export default async function Loading() {
  const cookieStore = await cookies();
  const locale = normalizeLocaleOverride(cookieStore.get(LOCALE_OVERRIDE_COOKIE)?.value) ?? "en";
  const copy = getRouteLoadingLabels(locale).settings;

  return (
    <RouteLoadingState
      eyebrow={copy.eyebrow}
      title={copy.title}
      body={copy.body}
    />
  );
}
