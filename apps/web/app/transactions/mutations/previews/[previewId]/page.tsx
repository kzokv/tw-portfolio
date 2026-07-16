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
}

export default async function PostedTransactionMutationPreviewPage({
  params,
}: PostedTransactionMutationPreviewPageProps) {
  const { previewId } = await params;
  const [session, profile, sidebarOpen, settings, initialPreview] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<PostedTransactionMutationPreviewDto>(
      `/portfolio/transactions/mutations/previews/${encodeURIComponent(previewId)}`,
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
        />
      </AppShell>
    </Suspense>
  );
}
