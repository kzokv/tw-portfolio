"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TransactionPrimaryDto } from "@vakwen/shared-types";
import { formatNumber } from "../../lib/utils";
import { useTransactionsPrimaryData } from "../../features/portfolio/hooks/useTransactionsPrimaryData";
import { RecentTransactionsCard } from "../dashboard/RecentTransactionsCard";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { AddTransactionCard } from "../portfolio/AddTransactionCard";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../ui/Tabs";
import { AiInboxPanel } from "./AiInboxPanel";

interface TransactionsClientProps {
  initialTab?: "posted" | "ai-inbox";
  initialBatchId?: string | null;
  initialContextId?: string | null;
  initialPrimaryData?: TransactionPrimaryDto | null;
}

export function TransactionsClient({
  initialTab = "posted",
  initialBatchId = null,
  initialContextId = null,
  initialPrimaryData = null,
}: TransactionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"posted" | "ai-inbox">(initialTab);
  const {
    uiDict: dict,
    locale,
    routeCachePolicy,
    sessionUserId,
    isSharedContext,
    sharedContextPermissions,
    transactionSubmission,
    transactionAccountOptions,
    contextRefreshSignal,
  } = useAppShellData();
  const resetCount = useCardLayoutResetCount("transactions");
  const cacheKey = buildRouteDtoCacheKey("transactions-primary", getRouteDtoContextScope(sessionUserId), locale);
  const seededPrimaryData = contextRefreshSignal === 0 ? initialPrimaryData : null;
  const primary = useTransactionsPrimaryData(seededPrimaryData, cacheKey, routeCachePolicy);
  const addPanelRef = useRef<HTMLDivElement | null>(null);
  const effectiveTransactionAccountOptions = transactionAccountOptions.length > 0
    ? transactionAccountOptions
    : primary.data.accountOptions;
  const canWriteTransactions = !isSharedContext || sharedContextPermissions.canWriteTransactions;
  const canReadAiDrafts = !isSharedContext || sharedContextPermissions.canReadAiDrafts;

  useEffect(() => {
    setActiveTab(initialTab === "ai-inbox" && !canReadAiDrafts ? "posted" : initialTab);
  }, [canReadAiDrafts, initialTab]);

  // Re-fetch when AppShell signals a context/data change (shared-context
  // switch, transaction submit, retry click). Initial mount skipped.
  const firstSignalRef = useRef(true);
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void primary.refresh();
  }, [contextRefreshSignal, primary.refresh]);

  // TODO(performance-smooth-pages): switch these summary cards to a dedicated
  // transactions read-model endpoint when the backend exposes one. For now we
  // keep `/transactions` independent from `/dashboard/overview` by deriving
  // lightweight metrics from recent transactions + shell account config.
  const recentCountValue = primary.isBootstrapping
    ? "..."
    : formatNumber(primary.data.recentTransactions.length, locale);
  const uniqueTickerCount = primary.isBootstrapping
    ? "..."
    : formatNumber(new Set(primary.data.recentTransactions.map((item) => `${item.ticker}:${item.marketCode ?? "na"}`)).size, locale);
  const accountCountValue = effectiveTransactionAccountOptions.length > 0
    ? formatNumber(effectiveTransactionAccountOptions.length, locale)
    : primary.isBootstrapping
      ? "..."
      : "0";
  const restoredLabel = primary.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(primary.restoredAt))
    : null;

  function handleTabChange(next: string) {
    const tab = next === "ai-inbox" && canReadAiDrafts ? "ai-inbox" : "posted";
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

  function handleAddTransactionClick() {
    if (activeTab !== "posted") {
      handleTabChange("posted");
      window.setTimeout(() => {
        addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }

    addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="stagger grid min-w-0 gap-6">
      <section
        className="grid gap-4 rounded-xl border border-border bg-card px-5 py-5 shadow-sm sm:px-6"
        data-testid="transactions-intro"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/78">{dict.navigation.transactionsLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{dict.navigation.transactionsLabel}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{dict.navigation.transactionsDescription}</p>
          </div>
          <button
            type="button"
            onClick={handleAddTransactionClick}
            disabled={!canWriteTransactions}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            {dict.transactions.title}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label={dict.dashboardHome.accountCountLabel}
            value={accountCountValue}
            detail={dict.navigation.transactionsLabel}
          />
          <CompactMetric
            label={dict.transactions.recentLedgerTitle}
            value={recentCountValue}
            detail={dict.transactions.recentLedgerDescription}
          />
          <CompactMetric
            label={dict.holdings.tickerTerm}
            value={uniqueTickerCount}
            detail={dict.transactions.verificationDescription}
          />
          <CompactMetric
            label={dict.transactions.verificationTitle}
            value={activeTab === "ai-inbox" ? "AI" : dict.navigation.transactionsLabel}
            detail={!canWriteTransactions && isSharedContext ? dict.switcher.readonlyDescription : dict.navigation.transactionsDescription}
          />
        </div>
      </section>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="transactions-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {primary.restoredFromCache && restoredLabel ? (
            <span data-testid="transactions-cache-restore-label">Restored from cache at {restoredLabel}</span>
          ) : (
            <span>Recent rows stay visible while transactions refresh.</span>
          )}
          {primary.isRefreshing ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Refreshing
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => { void primary.refresh(); }}
          disabled={primary.isRefreshing}
          data-testid="transactions-refresh-button"
        >
          Refresh
        </Button>
      </div>

      <TabsRoot value={activeTab} onValueChange={handleTabChange}>
        <TabsList data-testid="transactions-tabs">
          <TabsTrigger value="posted" data-testid="transactions-tab-posted">Posted</TabsTrigger>
          {canReadAiDrafts ? (
            <TabsTrigger value="ai-inbox" data-testid="transactions-tab-ai-inbox">AI Inbox</TabsTrigger>
          ) : null}
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
              { slug: "transactions-recent", fullWidth: true },
              { slug: "transactions-status", fullWidth: true },
              { slug: "transactions-add", fullWidth: true },
            ]}
          >
            {(slug) => {
              switch (slug) {
                case "transactions-recent":
                  return (
                    <RecentTransactionsCard
                      items={primary.data.recentTransactions}
                      locale={locale}
                      dict={dict}
                      isLoading={primary.isBootstrapping}
                      errorMessage={primary.errorMessage}
                      variant="primary"
                    />
                  );
                case "transactions-status":
                  return (
                    <Card data-testid="transactions-verification-panel">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">
                        {dict.transactions.verificationTitle}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-foreground">{dict.transactions.verificationTitle}</h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{dict.transactions.verificationDescription}</p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <CompactMetric
                          label={dict.dashboardHome.accountCountLabel}
                          value={accountCountValue}
                          detail={dict.navigation.transactionsLabel}
                        />
                        <CompactMetric
                          label={dict.transactions.recentLedgerTitle}
                          value={recentCountValue}
                          detail={dict.transactions.recentLedgerDescription}
                        />
                        <CompactMetric
                          label={dict.holdings.tickerTerm}
                          value={uniqueTickerCount}
                          detail={dict.transactions.verificationDescription}
                        />
                      </div>
                    </Card>
                  );
                case "transactions-add":
                  return !canWriteTransactions ? (
                    <Card
                      className="border border-rose-200 bg-rose-50/90 text-rose-700"
                      data-testid="transactions-readonly"
                    >
                      <p role="status" aria-live="polite">{dict.switcher.readonlyDescription}</p>
                    </Card>
                  ) : (
                    <Card>
                      <div ref={addPanelRef} className="mb-5 min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">{dict.transactions.title}</p>
                        <h2 className="mt-2 text-xl font-semibold text-foreground">{dict.transactions.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{dict.transactions.description}</p>
                      </div>
                      <AddTransactionCard
                        value={transactionSubmission.draftTransaction}
                        accountOptions={effectiveTransactionAccountOptions}
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
                        framed={false}
                        showHeader={false}
                        priceHint={transactionSubmission.priceHint}
                        showPriceUnavailableHint={transactionSubmission.showPriceUnavailableHint}
                        feeEstimate={transactionSubmission.feeEstimate}
                      />
                    </Card>
                  );
                default:
                  return null;
              }
            }}
          </SortableCardGrid>
        </TabsContent>

        {canReadAiDrafts ? (
          <TabsContent value="ai-inbox">
            <AiInboxPanel
              initialBatchId={initialBatchId}
              initialContextId={initialContextId}
              locale={locale}
            />
          </TabsContent>
        ) : null}
      </TabsRoot>
    </div>
  );
}

function CompactMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
