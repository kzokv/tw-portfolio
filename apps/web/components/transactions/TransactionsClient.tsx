"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
import { useRecentTransactions } from "../../features/portfolio/hooks/useRecentTransactions";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { RecentTransactionsCard } from "../dashboard/RecentTransactionsCard";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { RouteHeroPanel, StatusStripCard } from "../layout/SectionHeroPanels";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { AddTransactionCard } from "../portfolio/AddTransactionCard";
import { Card } from "../ui/Card";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../ui/Tabs";
import { AiInboxPanel } from "./AiInboxPanel";

interface TransactionsClientProps {
  initialTab?: "posted" | "ai-inbox";
  initialBatchId?: string | null;
  initialContextId?: string | null;
}

export function TransactionsClient({
  initialTab = "posted",
  initialBatchId = null,
  initialContextId = null,
}: TransactionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"posted" | "ai-inbox">(initialTab);
  const {
    dashboard,
    uiDict: dict,
    locale,
    isSharedContext,
    isBootstrapping,
    isI18nReady,
    transactionSubmission,
    transactionAccountOptions,
    contextRefreshSignal,
  } = useAppShellData();
  const resetCount = useCardLayoutResetCount("transactions");
  // TransactionsClient only mounts on /transactions, so enabled is unconditionally true.
  const recentTransactions = useRecentTransactions({ limit: 6, enabled: true });

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Re-fetch when AppShell signals a context/data change (shared-context
  // switch, transaction submit, retry click). Initial mount skipped.
  const firstSignalRef = useRef(true);
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void recentTransactions.refresh();
  }, [contextRefreshSignal, recentTransactions.refresh]);

  if (isBootstrapping || !isI18nReady) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading />
      </>
    );
  }

  const quotedHoldingCount = dashboard.holdings.filter((holding) => holding.currentUnitPrice !== null).length;
  const quoteCoverageValue = dashboard.holdings.length === 0
    ? "-"
    : formatPercent((quotedHoldingCount / dashboard.holdings.length) * 100, locale);
  const quoteCoverageDetail = dashboard.holdings.length === 0
    ? dict.dashboardHome.holdingsEmpty
    : `${formatNumber(quotedHoldingCount, locale)} / ${formatNumber(dashboard.holdings.length, locale)}`;

  function handleTabChange(next: string) {
    const tab = next === "ai-inbox" ? "ai-inbox" : "posted";
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "posted") {
      params.delete("tab");
      params.delete("batch");
      params.delete("context");
    } else {
      params.set("tab", "ai-inbox");
      if (initialBatchId) params.set("batch", initialBatchId);
      if (initialContextId) params.set("context", initialContextId);
    }
    const query = params.toString();
    router.replace(query ? `/transactions?${query}` : "/transactions", { scroll: false });
  }

  return (
    <div className="stagger grid min-w-0 gap-6">
      <RouteHeroPanel
        eyebrow={dict.navigation.transactionsLabel}
        title={dict.transactions.title}
        description={dict.navigation.transactionsDescription}
        testId="transactions-intro"
        metrics={[
          {
            label: dict.dashboardHome.accountCountLabel,
            value: formatNumber(dashboard.summary.accountCount, locale),
            detail: dict.navigation.transactionsLabel,
          },
          {
            label: dict.dashboardHome.holdingCountLabel,
            value: formatNumber(dashboard.summary.holdingCount, locale),
            detail: dict.holdings.entries.replace("{count}", String(dashboard.summary.holdingCount)),
          },
          {
            label: dict.dashboardHome.issueCountLabel,
            value: formatNumber(dashboard.summary.openIssueCount, locale),
            detail: dashboard.summary.openIssueCount > 0 ? dict.dialogs.integrityTitle : dict.dashboardHome.actionHealthyTitle,
          },
          {
            label: dict.dashboardHome.quoteCoverageLabel,
            value: quoteCoverageValue,
            detail: quoteCoverageDetail,
          },
        ]}
      />

      <TabsRoot value={activeTab} onValueChange={handleTabChange}>
        <TabsList data-testid="transactions-tabs">
          <TabsTrigger value="posted" data-testid="transactions-tab-posted">Posted</TabsTrigger>
          <TabsTrigger value="ai-inbox" data-testid="transactions-tab-ai-inbox">AI Inbox</TabsTrigger>
        </TabsList>

        <TabsContent value="posted">
          {/*
            KZO-162 — All three transactions cards (form/readonly + status + recent)
            render through one SortableCardGrid. All slugs declare
            `fullWidth: true` so they stack vertically and any can be reordered
            to any position. The `transactions-add` slot renders the
            AddTransactionCard normally and a read-only notice in shared context;
            either way the slot stays in the saved order so a user's preferred
            position survives context switches.
            To add a card here, append a `{slug, fullWidth}` entry AND add a
            `case` to the switch below.
          */}
          <SortableCardGrid
            key={`card-grid-transactions-${resetCount}`}
            orderKey="transactions"
            cards={[
              { slug: "transactions-add", fullWidth: true },
              { slug: "transactions-status", fullWidth: true },
              { slug: "transactions-recent", fullWidth: true },
            ]}
          >
            {(slug) => {
              switch (slug) {
                case "transactions-add":
                  return isSharedContext ? (
                    <Card
                      className="border border-rose-200 bg-rose-50/90 text-rose-700"
                      data-testid="transactions-readonly"
                    >
                      <p role="status" aria-live="polite">{dict.switcher.readonlyDescription}</p>
                    </Card>
                  ) : (
                    <AddTransactionCard
                      value={transactionSubmission.draftTransaction}
                      accountOptions={transactionAccountOptions}
                      pending={transactionSubmission.isSubmitting}
                      onChange={(next) => {
                        transactionSubmission.setMessage("");
                        transactionSubmission.setDraftTransaction(next);
                      }}
                      onUnitPriceEdited={transactionSubmission.markUnitPriceEdited}
                      onSubmit={async () => {
                        await transactionSubmission.submit();
                      }}
                      dict={dict}
                      locale={locale}
                      priceHint={transactionSubmission.priceHint}
                      showPriceUnavailableHint={transactionSubmission.showPriceUnavailableHint}
                      feeEstimate={transactionSubmission.feeEstimate}
                    />
                  );
                case "transactions-status":
                  return (
                    <StatusStripCard
                      eyebrow={dict.navigation.transactionsLabel}
                      title={dict.transactions.verificationTitle}
                      description={dict.transactions.verificationDescription}
                      metrics={[
                        {
                          label: dict.dashboardHome.marketValueLabel,
                          value: dashboard.summary.marketValueAmount !== null
                            ? formatCurrencyAmount(dashboard.summary.marketValueAmount, dashboard.summary.reportingCurrency, locale)
                            : dict.dashboardHome.noMarketValue,
                        },
                        {
                          label: dict.dashboardHome.totalCostLabel,
                          value: formatCurrencyAmount(dashboard.summary.totalCostAmount, dashboard.summary.reportingCurrency, locale),
                        },
                        {
                          label: dict.dashboardHome.holdingCountLabel,
                          value: formatNumber(dashboard.summary.holdingCount, locale),
                        },
                      ]}
                      testId="transactions-verification-panel"
                    />
                  );
                case "transactions-recent":
                  return (
                    <RecentTransactionsCard
                      items={recentTransactions.items}
                      locale={locale}
                      dict={dict}
                      isLoading={recentTransactions.isLoading}
                      errorMessage={recentTransactions.errorMessage}
                    />
                  );
                default:
                  return null;
              }
            }}
          </SortableCardGrid>
        </TabsContent>

        <TabsContent value="ai-inbox">
          <AiInboxPanel
            initialBatchId={initialBatchId}
            initialContextId={initialContextId}
            locale={locale}
          />
        </TabsContent>
      </TabsRoot>
    </div>
  );
}
