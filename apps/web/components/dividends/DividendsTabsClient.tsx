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

import { useCallback } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS as LEDGER_ONLY_PARAMS,
  type DividendsTabValue,
} from "./dividendsTabsUtils";

interface DividendsTabsClientProps {
  initialTab: DividendsTabValue;
  calendarLabel: string;
  ledgerLabel: string;
  calendarSlot: ReactNode;
  ledgerSlot: ReactNode;
}

export function DividendsTabsClient({
  initialTab,
  calendarLabel,
  ledgerLabel,
  calendarSlot,
  ledgerSlot,
}: DividendsTabsClientProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/dividends";
  const searchParams = useSearchParams();

  const handleTabChange = useCallback(
    (next: string) => {
      const value = next as DividendsTabValue;
      const params = new URLSearchParams(searchParams?.toString() ?? "");

      if (value === "calendar") {
        // Tab switch to calendar drops ledger-only params (Phase 5a lock).
        for (const key of LEDGER_ONLY_PARAMS) params.delete(key);
        params.delete("view");
      } else {
        params.set("view", "ledger");
      }

      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;

      // Sync URL synchronously for E2E page.url() assertions
      // (per .claude/rules/playwright-navigation-patterns.md).
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", url);
      }
      router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <Tabs
      value={initialTab}
      onValueChange={handleTabChange}
      data-testid="dividends-tabs"
      className="flex flex-col gap-6"
    >
      <TabsList className="self-start">
        <TabsTrigger value="calendar" data-testid="dividends-tab-calendar">
          {calendarLabel}
        </TabsTrigger>
        <TabsTrigger value="ledger" data-testid="dividends-tab-ledger">
          {ledgerLabel}
        </TabsTrigger>
      </TabsList>

      {/* forceMount-equivalent: only mount the active slot so heavy
          components (DividendReviewClient with SSR data) don't render
          when not needed. The Tabs value drives which slot is in DOM. */}
      <TabsContent value="calendar" data-testid="dividends-tabpanel-calendar">
        {calendarSlot}
      </TabsContent>
      <TabsContent value="ledger" data-testid="dividends-tabpanel-ledger">
        {ledgerSlot}
      </TabsContent>
    </Tabs>
  );
}
