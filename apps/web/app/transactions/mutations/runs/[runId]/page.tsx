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
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ as?: string | string[] }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const contextOwnerId = typeof query.as === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(query.as)
    ? query.as
    : null;
  const [session, profile, sidebarOpen, settings, initialRun] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<PostedTransactionMutationRunDto>(
      `/portfolio/transactions/mutations/runs/${encodeURIComponent(runId)}`,
      contextOwnerId
        ? { contextScope: "session", headers: { "x-context-user-id": contextOwnerId } }
        : undefined,
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
        <PostedTransactionMutationRunClient
          initialRun={initialRun}
          locale={locale}
          contextOwnerId={contextOwnerId}
        />
      </AppShell>
    </Suspense>
  );
}
