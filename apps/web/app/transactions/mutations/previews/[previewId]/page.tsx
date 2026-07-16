import { Suspense } from "react";
import type { PostedTransactionMutationPreviewDto, UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../../../../components/dashboard/DashboardLoading";
import { AppShell } from "../../../../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../../../../components/layout/i18n";
import { PostedTransactionMutationPreviewClient } from "../../../../../components/transactions/PostedTransactionMutationPreviewClient";
import { getJson } from "../../../../../lib/api";
import { requireSession } from "../../../../../lib/auth";
import { readSidebarStateCookie } from "../../../../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../../../../features/profile/hooks/useProfile";

interface PostedTransactionMutationPreviewPageProps {
  params: Promise<{ previewId: string }>;
  searchParams: Promise<{ as?: string | string[] }>;
}

export default async function PostedTransactionMutationPreviewPage({
  params,
  searchParams,
}: PostedTransactionMutationPreviewPageProps) {
  const [{ previewId }, query] = await Promise.all([params, searchParams]);
  const contextOwnerId = typeof query.as === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(query.as)
    ? query.as
    : null;
  const [session, profile, sidebarOpen, settings, initialPreview] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<PostedTransactionMutationPreviewDto>(
      `/portfolio/transactions/mutations/previews/${encodeURIComponent(previewId)}`,
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
        <PostedTransactionMutationPreviewClient
          initialPreview={initialPreview}
          locale={locale}
          contextOwnerId={contextOwnerId}
        />
      </AppShell>
    </Suspense>
  );
}
