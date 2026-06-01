import { Suspense } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { CashLedgerClient } from "../../features/cash-ledger/components/CashLedgerClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import {
  fetchCashLedgerEntries,
  type AccountWithLiveBalance,
} from "../../features/cash-ledger/services/cashLedgerService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function CashLedgerPage() {
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile"),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings").catch(() => null),
  ]);

  const locale: LocaleCode = settings?.locale ?? "en";

  const [dict, initialData, initialAccounts] = await Promise.all([
    Promise.resolve(getDictionary(locale)),
    fetchCashLedgerEntries().catch(() => ({
      entries: [],
      summary: [],
      total: 0,
    })),
    getJson<AccountWithLiveBalance[]>("/accounts?includeBalances=true").catch(() => null),
  ]);

  return (
    <Suspense fallback={<DashboardLoading standalone />}>
      <AppShell
        section="cash-ledger"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSidebarOpen={sidebarOpen}
      >
        <CashLedgerClient
          initialData={initialData}
          initialAccounts={initialAccounts ?? []}
          initialAccountMetaReady={initialAccounts !== null}
          dict={dict}
          locale={locale}
        />
      </AppShell>
    </Suspense>
  );
}
