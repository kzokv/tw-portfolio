"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LocaleCode } from "@tw-portfolio/shared-types";
import { getDictionary } from "../../lib/i18n";
import { HoldingsTable } from "../portfolio/HoldingsTable";
import type { TransactionInput } from "../portfolio/types";
import { SettingsDrawer } from "../settings/SettingsDrawer";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { Button } from "../ui/Button";
import { TopBar } from "./TopBar";
import { IntegrityIssueDialog } from "../../features/dashboard/components/IntegrityIssueDialog";
import { useDashboardData } from "../../features/dashboard/hooks/useDashboardData";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import { useSettingsSave } from "../../features/settings/hooks/useSettingsSave";
import { SummarySection } from "../dashboard/SummarySection";
import { DividendsSection } from "../dashboard/DividendsSection";
import { ActionCenterSection } from "../dashboard/ActionCenterSection";
import { QuickTransactionSection } from "../dashboard/QuickTransactionSection";

const DEFAULT_TRANSACTION: TransactionInput = {
  accountId: "",
  symbol: "2330",
  quantity: 1,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-01-01",
  type: "BUY",
  isDayTrade: false,
};

export function AppShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dashboard = useDashboardData({ initialTransaction: DEFAULT_TRANSACTION });

  const locale: LocaleCode = dashboard.settings?.locale ?? "en";
  const dict = useMemo(() => getDictionary(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: dashboard.refresh,
  });

  const recomputeAction = useRecomputeAction({
    locale,
    fallbackConfirm: dict.recompute.fallbackConfirm,
    refresh: dashboard.refresh,
  });

  const settingsSave = useSettingsSave({
    refresh: dashboard.refresh,
    closeDrawer: () => setDrawerOpen(false),
  });

  /** Ready when we have user settings (locale). Later: set false until async i18n load completes. */
  const isI18nReady = !!dashboard.settings;
  const showPageSkeleton = dashboard.isBootstrapping || !isI18nReady;

  const drawerOpen = searchParams.get("drawer") === "settings";

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (open) params.set("drawer", "settings");
      else params.delete("drawer");

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    transactionSubmission.setDraftTransaction((previous) => dashboard.synchronizeTransactionDraft(previous));
  }, [dashboard.synchronizeTransactionDraft, transactionSubmission.setDraftTransaction]);

  const globalError = transactionSubmission.errorMessage || recomputeAction.errorMessage || dashboard.errorMessage;
  const transactionMessage = transactionSubmission.message;
  const recomputeMessage = recomputeAction.message;

  return (
    <div className="app-shell relative min-h-screen min-w-0 overflow-x-hidden">
      <TopBar
        skeleton={dashboard.isBootstrapping}
        userId={dashboard.settings?.userId}
        onOpenSettings={() => setDrawerOpen(true)}
        productName={dict.topBar.productName}
        title={dict.topBar.title}
        titleTooltip={dict.topBar.titleTooltip}
        openSettingsLabel={dict.topBar.openSettingsLabel}
      />

      <main className="relative mx-auto min-w-0 w-full max-w-7xl px-4 py-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
        {globalError ? (
          <div
            className="mb-4 rounded-[20px] border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.12)] px-4 py-3 text-sm text-rose-100"
            role="status"
            aria-live="polite"
            data-testid="global-error-banner"
          >
            <p>{dict.feedback.requestFailedPrefix}: {globalError}</p>
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  dashboard.setErrorMessage("");
                  transactionSubmission.setErrorMessage("");
                  recomputeAction.setErrorMessage("");
                  void dashboard.refresh().catch(() => undefined);
                }}
              >
                {dict.actions.retry}
              </Button>
            </div>
          </div>
        ) : null}

        {!globalError && transactionMessage ? (
          <p
            className="mb-4 rounded-[20px] border border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.12)] px-4 py-3 text-sm text-emerald-50"
            data-testid="transaction-status"
            role="status"
            aria-live="polite"
          >
            {transactionMessage}
          </p>
        ) : null}

        {!globalError && !transactionMessage && recomputeMessage ? (
          <p
            className="mb-4 rounded-[20px] border border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.12)] px-4 py-3 text-sm text-emerald-50"
            data-testid="recompute-status"
            role="status"
            aria-live="polite"
          >
            {recomputeMessage}
          </p>
        ) : showPageSkeleton ? (
          <div className="mb-4 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        ) : null}

        {showPageSkeleton ? (
          <DashboardLoading />
        ) : (
          <div className="stagger grid min-w-0 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-12">
              <SummarySection summary={dashboard.summary} dict={dict} locale={locale} />
            </div>
            <div className="xl:col-span-8 min-w-0">
              <HoldingsTable holdings={dashboard.holdings} dict={dict} locale={locale} />
            </div>
            <div className="xl:col-span-4 min-w-0">
              <ActionCenterSection
                locale={locale}
                settings={dashboard.settings}
                integrityIssue={dashboard.actions.integrityIssue}
                pending={recomputeAction.isRunning}
                onRecompute={recomputeAction.runRecompute}
                onOpenSettings={() => setDrawerOpen(true)}
                dict={dict}
              />
            </div>
            <div className="xl:col-span-8 min-w-0">
              <DividendsSection
                upcoming={dashboard.dividends.upcoming}
                recent={dashboard.dividends.recent}
                dict={dict}
                locale={locale}
              />
            </div>
            <div className="xl:col-span-4 min-w-0">
              <QuickTransactionSection
                value={transactionSubmission.draftTransaction}
                accountOptions={dashboard.accounts.map((account) => ({ id: account.id, name: account.name }))}
                symbolOptions={dashboard.symbols}
                pending={transactionSubmission.isSubmitting}
                onChange={(next) => {
                  transactionSubmission.setMessage("");
                  transactionSubmission.setDraftTransaction(dashboard.synchronizeTransactionDraft(next));
                }}
                onSubmit={transactionSubmission.submit}
                dict={dict}
              />
            </div>
          </div>
        )}
      </main>

      <IntegrityIssueDialog
        issue={dashboard.actions.integrityIssue}
        open={dashboard.showIntegrityDialog}
        onOpenChange={dashboard.setShowIntegrityDialog}
        onOpenSettings={() => setDrawerOpen(true)}
        dict={dict}
      />

      <SettingsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        settings={dashboard.settings}
        accounts={dashboard.accounts}
        feeProfiles={dashboard.feeProfiles}
        feeProfileBindings={dashboard.feeProfileBindings}
        isSaving={settingsSave.isSaving}
        errorMessage={settingsSave.errorMessage}
        onSave={settingsSave.save}
        dict={dict}
      />
    </div>
  );
}
