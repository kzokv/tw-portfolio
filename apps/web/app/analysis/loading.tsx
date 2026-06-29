import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { LOCALE_OVERRIDE_COOKIE, normalizeLocaleOverride } from "../../lib/i18n/localeOverrideCookie";
import { cookies } from "next/headers";

export default async function AnalysisLoading() {
  const cookieStore = await cookies();
  const locale = normalizeLocaleOverride(cookieStore.get(LOCALE_OVERRIDE_COOKIE)?.value);
  const labels = getRouteLoadingLabels(locale ?? undefined);
  return <DashboardLoading standalone locale={locale ?? "en"} loadingCopy={labels.analysis} />;
}
