"use client";

// Phase 5a — Tabs container that merges /dividends + /dividends/review into
// one route. Tab axis is driven by ?view= query param:
//   - view absent  → calendar (default)
//   - view=calendar → calendar
//   - view=ledger  → ledger
//   - any ledger-only param (status, sortBy, etc.) without explicit view= →
//     ledger (implied per scope-grill Phase 5 lock #2)
//
// URL sync uses router.replace + window.history.replaceState pair per
// .claude/rules/playwright-navigation-patterns.md so E2E page.url()
// assertions update synchronously.
//
// Tab switch from ledger → calendar drops ledger-only params (the calendar
// has its own date-range axis via month picker).

import { useCallback, useEffect, useState } from "react";
import type { AccountDto, LocaleCode } from "@vakwen/shared-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import type { AppDictionary } from "../../lib/i18n";
import {
  currentMonthQuery,
  searchParamsToReviewQuery,
} from "./dividendsPageQuery";
import { DividendCalendarClient } from "./DividendCalendarClient";
import { DividendReviewClient } from "./DividendReviewClient";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS as LEDGER_ONLY_PARAMS,
  type DividendsTabValue,
} from "./dividendsTabsUtils";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
  type DividendLedgerReviewResponse,
} from "../../features/dividends/services/dividendService";
import { fetchShellPortfolioConfig } from "../../features/settings/services/shellPortfolioConfigService";
import type { DividendCalendarSnapshot } from "../../features/dividends/types";

interface DividendsTabsClientProps {
  initialTab: DividendsTabValue;
  calendarLabel: string;
  ledgerLabel: string;
  dict: AppDictionary;
  locale: LocaleCode;
  accounts: AccountDto[];
  initialCalendarSnapshot: DividendCalendarSnapshot | null;
  initialReviewData: DividendLedgerReviewResponse | null;
  initialYears: number[];
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      className="rounded-[24px] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm"
      data-testid="dividends-tab-loading"
    >
      Loading {label.toLowerCase()}...
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-[24px] border border-destructive/30 bg-destructive/5 px-5 py-10 text-center text-sm text-destructive shadow-sm"
      data-testid="dividends-tab-error"
      role="status"
    >
      {message}
    </div>
  );
}

export function DividendsTabsClient({
  initialTab,
  calendarLabel,
  ledgerLabel,
  dict,
  locale,
  accounts,
  initialCalendarSnapshot,
  initialReviewData,
  initialYears,
}: DividendsTabsClientProps) {
  const [activeTab, setActiveTab] = useState<DividendsTabValue>(initialTab);
  const [calendarSnapshot, setCalendarSnapshot] = useState<DividendCalendarSnapshot | null>(initialCalendarSnapshot);
  const [reviewData, setReviewData] = useState<DividendLedgerReviewResponse | null>(initialReviewData);
  const [years, setYears] = useState<number[]>(initialYears);
  const [ledgerAccounts, setLedgerAccounts] = useState<AccountDto[]>(accounts);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const prioritizeLedger = (initialReviewData?.aggregates.openCount ?? 0) > 0;
  const orderedTabs = prioritizeLedger
    ? [
      { value: "ledger" as const, label: ledgerLabel, testId: "dividends-tab-ledger" },
      { value: "calendar" as const, label: calendarLabel, testId: "dividends-tab-calendar" },
    ]
    : [
      { value: "calendar" as const, label: calendarLabel, testId: "dividends-tab-calendar" },
      { value: "ledger" as const, label: ledgerLabel, testId: "dividends-tab-ledger" },
    ];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setCalendarSnapshot(initialCalendarSnapshot);
  }, [initialCalendarSnapshot]);

  useEffect(() => {
    setReviewData(initialReviewData);
  }, [initialReviewData]);

  useEffect(() => {
    setYears(initialYears);
  }, [initialYears]);

  useEffect(() => {
    setLedgerAccounts(accounts);
  }, [accounts]);

  const handleTabChange = useCallback(
    (next: string) => {
      const value = next as DividendsTabValue;
      const params = new URLSearchParams(window.location.search);

      if (value === "calendar") {
        for (const key of LEDGER_ONLY_PARAMS) params.delete(key);
        params.delete("view");
      } else {
        params.set("view", "ledger");
      }

      const qs = params.toString();
      const url = qs ? `/dividends?${qs}` : "/dividends";

      window.history.replaceState(null, "", url);
      setActiveTab(value);
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "calendar" || calendarSnapshot) return;

    let cancelled = false;
    setCalendarError("");
    setIsCalendarLoading(true);
    void fetchDividendCalendarSnapshot(currentMonthQuery())
      .then((snapshot) => {
        if (!cancelled) {
          setCalendarSnapshot(snapshot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCalendarError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCalendarLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, calendarSnapshot]);

  useEffect(() => {
    if (activeTab !== "ledger" || (reviewData && years.length > 0)) return;

    let cancelled = false;
    setLedgerError("");
    setIsLedgerLoading(true);
    void Promise.all([
      reviewData
        ? Promise.resolve(reviewData)
        : fetchDividendLedgerReview(searchParamsToReviewQuery(new URLSearchParams(window.location.search))),
      years.length > 0 ? Promise.resolve(years) : fetchDividendLedgerYears(),
    ])
      .then(([nextReviewData, nextYears]) => {
        if (!cancelled) {
          setReviewData(nextReviewData);
          setYears(nextYears);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLedgerError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLedgerLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, reviewData, years]);

  useEffect(() => {
    if (activeTab !== "ledger" || ledgerAccounts.length > 0) return;

    let cancelled = false;
    void fetchShellPortfolioConfig()
      .then((config) => {
        if (!cancelled) {
          setLedgerAccounts(config.accounts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLedgerAccounts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, ledgerAccounts.length]);


  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      data-testid="dividends-tabs"
      className="flex flex-col gap-4"
    >
      <TabsList className="self-start">
        {orderedTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} data-testid={tab.testId}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* forceMount-equivalent: only mount the active slot so heavy
          components (DividendReviewClient with SSR data) don't render
          when not needed. The Tabs value drives which slot is in DOM. */}
      <TabsContent value="calendar" data-testid="dividends-tabpanel-calendar">
        {calendarSnapshot ? (
          <DividendCalendarClient initialSnapshot={calendarSnapshot} dict={dict} locale={locale} />
        ) : isCalendarLoading ? (
          <LoadingPanel label={calendarLabel} />
        ) : calendarError ? (
          <ErrorPanel message={calendarError} />
        ) : null}
      </TabsContent>
      <TabsContent value="ledger" data-testid="dividends-tabpanel-ledger">
        {reviewData ? (
          <DividendReviewClient
            initialData={reviewData}
            dict={dict}
            locale={locale}
            accounts={ledgerAccounts}
            years={years}
          />
        ) : isLedgerLoading ? (
          <LoadingPanel label={ledgerLabel} />
        ) : ledgerError ? (
          <ErrorPanel message={ledgerError} />
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
