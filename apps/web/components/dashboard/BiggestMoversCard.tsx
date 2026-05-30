// Phase 5d — Biggest movers list, top 5 by |changePercent|.
// Client-derived from dashboard.holdings (no new API). Non-draggable,
// lives inside the hero block per scope-grill lock G5.

import Link from "next/link";
import type { DashboardOverviewHoldingDto, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";

interface BiggestMoversCardProps {
  holdings: DashboardOverviewHoldingDto[];
  locale: LocaleCode;
  // Reserved for future i18n adoption — keys not yet on AppDictionary.
  dict?: AppDictionary;
}

const TOP_N = 5;

export function BiggestMoversCard({ holdings, locale }: BiggestMoversCardProps) {
  const eligible = holdings.filter(
    (h) => h.changePercent !== null && h.quoteStatus !== "missing",
  );

  // Sort by absolute % change desc, take top 5.
  const movers = eligible
    .slice()
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, TOP_N);

  // Labels intentionally hard-coded English for v1 — i18n keys not yet on
  // AppDictionary. Polish (en + zh-TW) tracked as a follow-up.
  return (
    <Card className="p-5" data-testid="dashboard-biggest-movers">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Biggest movers
      </p>

      {movers.length === 0 ? (
        <p
          className="mt-4 text-sm text-muted-foreground"
          data-testid="dashboard-biggest-movers-empty"
        >
          No moving holdings to show.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {movers.map((h) => {
            const tone = (h.changePercent ?? 0) > 0 ? "text-emerald-600" : (h.changePercent ?? 0) < 0 ? "text-rose-600" : "text-foreground";
            return (
              <li
                key={`${h.accountId}-${h.ticker}`}
                className="flex items-center justify-between gap-3"
                data-testid={`dashboard-biggest-movers-row-${h.ticker}`}
              >
                <Link
                  href={`/tickers/${encodeURIComponent(h.ticker)}?accountId=${encodeURIComponent(h.accountId)}`}
                  className="font-mono text-sm font-medium text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
                >
                  {h.ticker}
                </Link>
                <div className="flex items-center gap-3 text-right">
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
