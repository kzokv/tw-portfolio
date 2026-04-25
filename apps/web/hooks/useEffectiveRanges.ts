"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type DashboardPerformanceRange,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
} from "@tw-portfolio/shared-types";
import { getJson } from "../lib/api";

/**
 * KZO-161 — resolved dashboard timeframe list (3-tier user → admin → default
 * precedence), extracted from `AppShell.tsx:205-222` so both the dashboard
 * shell and the customize-ranges popover share the same fetch + state.
 *
 * Returns `refetch` so the gear popover can force a re-hydration after a
 * user PATCH `/user-preferences { dashboardPerformanceRanges: ... }` without
 * remounting the shell (design §7).
 *
 * Errors (network, 4xx/5xx, schema drift) are silently swallowed and the
 * existing value is retained — users should never see the dashboard block on
 * an effective-ranges hiccup.
 */
export interface UseEffectiveRangesResult {
  effectiveRanges: DashboardPerformanceRange[];
  refetch: () => void;
}

export function useEffectiveRanges(): UseEffectiveRangesResult {
  const [effectiveRanges, setEffectiveRanges] = useState<DashboardPerformanceRange[]>(
    () => [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
  );

  const refetch = useCallback(() => {
    void getJson<{ ranges: string[]; source: "user" | "admin" | "default" }>(
      "/user-preferences/effective-ranges",
    )
      .then((res) => {
        if (Array.isArray(res?.ranges) && res.ranges.length > 0) {
          setEffectiveRanges(res.ranges);
        }
      })
      .catch(() => {
        // Silent fallback: defaults (or the last successful fetch) stay in state.
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { effectiveRanges, refetch };
}
