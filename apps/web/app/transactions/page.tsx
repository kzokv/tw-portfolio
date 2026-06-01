import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { TransactionsClient } from "../../components/transactions/TransactionsClient";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface TransactionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const sp = await searchParams;
  const tab = firstParam(sp.tab) === "ai-inbox" ? "ai-inbox" as const : "posted" as const;
  const batchId = firstParam(sp.batch);
  const contextId = firstParam(sp.context);
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
  ]);
  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        section="transactions"
        isDemo={session.isDemo}
        localeOverride={settings?.locale ?? "en"}
        initialProfile={profile}
        initialSidebarOpen={sidebarOpen}
      >
        <TransactionsClient initialTab={tab} initialBatchId={batchId} initialContextId={contextId} />
      </AppShell>
    </Suspense>
  );
}
