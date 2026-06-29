// Phase 5d — Biggest movers list, top 5 by |changePercent|.
// Client-derived from dashboard.holdings (no new API). Non-draggable,
// lives inside the hero block per scope-grill lock G5.

import Link from "next/link";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import type { DashboardOverviewHoldingGroupDto } from "../../features/portfolio/holdingGroups";
import { buildSelectedSeriesId, buildUnrealizedPnlRoutePath } from "../../features/analysis/unrealizedPnlRouteState";
import { cn, formatCurrencyAmount, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";
import { holdingsFinanceToneClass } from "../holdings/holdingsStyle";

interface BiggestMoversCardProps {
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  dict: AppDictionary;
}

const TOP_N = 5;

export function BiggestMoversCard({ groups, locale, dict }: BiggestMoversCardProps) {
  const eligible = groups.filter(
    (h) => h.changePercent !== null && h.quoteStatus !== "missing",
  );

  // Sort by absolute % change desc, take top 5.
  const movers = eligible
    .slice()
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, TOP_N);

  return (
    <Card className="p-5" data-testid="dashboard-biggest-movers">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {dict.dashboardHome.biggestMoversTitle}
      </p>

      {movers.length === 0 ? (
        <p
          className="mt-4 text-sm text-muted-foreground"
          data-testid="dashboard-biggest-movers-empty"
        >
          {dict.dashboardHome.biggestMoversEmpty}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {movers.map((h) => {
            const tone = holdingsFinanceToneClass(h.changePercent ?? 0, "text-foreground");
            return (
              <li
                key={`${h.marketCode}-${h.ticker}`}
                className="flex items-center justify-between gap-3"
                data-testid={`dashboard-biggest-movers-row-${h.ticker}-${h.marketCode}`}
              >
                <Link
                  href={`/tickers/${encodeURIComponent(h.ticker)}?marketCode=${encodeURIComponent(h.marketCode)}`}
                  className="font-mono text-sm font-medium text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
                >
                  {h.ticker} <span className="text-xs text-muted-foreground">· {h.marketCode}</span>
                </Link>
                <div className="flex items-center gap-3 text-right">
                  <Link
                    href={buildMoverAnalysisHref(h)}
                    className="text-xs font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
                    aria-label={dict.reports.openUnrealizedPnlAnalysis}
                    data-testid={`dashboard-mover-analysis-link-${h.ticker}-${h.marketCode}`}
                  >
                    {dict.navigation.analysisLabel}
                  </Link>
                  <span className={cn("font-mono text-sm font-medium tabular-nums", tone)}>
                    {formatPercent(h.changePercent ?? 0, locale)}
                  </span>
                  {h.change !== null ? (
                    <span className={cn("font-mono text-xs tabular-nums", tone)}>
                      {formatCurrencyAmount(h.change, h.currency, locale)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function buildMoverAnalysisHref(group: DashboardOverviewHoldingGroupDto): string {
  return buildUnrealizedPnlRoutePath({
    range: "3M",
    markets: [group.marketCode],
    tickers: [group.ticker],
    selectionMode: "manual",
    selected: [buildSelectedSeriesId(group.marketCode, group.ticker)],
    reportingCurrency: group.reportingCurrency,
    view: "ticker-detail",
  });
}
