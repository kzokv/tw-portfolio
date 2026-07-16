import { Suspense } from "react";
import type { PostedTransactionMutationRunDto, UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../../../../components/layout/i18n";
import { PostedTransactionMutationRunClient } from "../../../../../components/transactions/PostedTransactionMutationRunClient";
import { getJson } from "../../../../../lib/api";
import { requireSession } from "../../../../../lib/auth";
import { readSidebarStateCookie } from "../../../../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../../../../features/profile/hooks/useProfile";

export default async function PostedTransactionMutationRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const [session, profile, sidebarOpen, settings, initialRun] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<PostedTransactionMutationRunDto>(
      `/portfolio/transactions/mutations/runs/${encodeURIComponent(runId)}`,
    ),
  ]);
  const locale = settings?.locale ?? "en";
  const loadingCopy = getRouteLoadingLabels(locale).transactions;

  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="transactions"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSettings={settings}
        initialSidebarOpen={sidebarOpen}
      >
        <PostedTransactionMutationRunClient initialRun={initialRun} locale={locale} />
      </AppShell>
    </Suspense>
  );
}
