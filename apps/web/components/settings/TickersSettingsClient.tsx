"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { MonitoredTickersSection } from "../../features/settings/components/MonitoredTickersSection";
import { InstrumentCatalogSheet } from "../../features/settings/components/InstrumentCatalogSheet";
import { useMonitoredTickers } from "../../features/settings/hooks/useMonitoredTickers";

/**
 * Phase 3d S2/S6 — `/settings/tickers` body.
 *
 * Mounts `<MonitoredTickersSection>` verbatim per A6 (deferred Phase 7
 * reskin). Catalog browse is the existing `<InstrumentCatalogSheet>`
 * toggled by the section's `Browse full catalog` button.
 *
 * Monitored-tickers add/remove uses the batch Save button — NOT auto-save
 * (per §8.1 sensitive-confirmation list).
 */
export function TickersSettingsClient() {
  const { locale } = useSettingsRouteContext();
  const searchParams = useSearchParams();
  const dict = getDictionary(locale);
  const tickers = useMonitoredTickers(true);
  const repairQuery = useMemo(
    () => parseTickerRepairQuery(searchParams ?? new URLSearchParams()),
    [searchParams],
  );

  const positionTickerKeys = useMemo(
    () =>
      new Set(
        tickers.monitoredTickers
          .filter((s) => s.source === "position")
          .map((s) => `${s.ticker}|${s.marketCode}`),
      ),
    [tickers.monitoredTickers],
  );

  useEffect(() => {
    if (!repairQuery.open) return;
    tickers.setShowCatalog(false);
    tickers.setRepairMode(true);
  }, [repairQuery.open, tickers.setRepairMode, tickers.setShowCatalog]);

  return (
    <div className="space-y-4" data-testid="settings-section-tickers">
      {repairQuery.fromDataHealth ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3" data-testid="settings-tickers-repair-origin">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{dict.settings.repairOriginTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{dict.settings.repairOriginDescription}</p>
              {repairQuery.suggestedLabels.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {dict.settings.repairSuggestedTickers}: <span className="font-mono text-foreground">{repairQuery.suggestedLabels.join(", ")}</span>
                </p>
              ) : null}
            </div>
            {repairQuery.returnTo ? (
              <Link
                href={repairQuery.returnTo}
                className="text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
                data-testid="settings-tickers-repair-return-link"
              >
                {dict.settings.repairOriginReturn}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      {tickers.showCatalog ? (
        <InstrumentCatalogSheet
          instruments={tickers.instruments}
          selectedTickers={tickers.selectedTickers}
          positionTickers={positionTickerKeys}
          onToggleTicker={tickers.toggleTicker}
          isLoadingCatalog={tickers.isCatalogLoading}
          catalogError={tickers.catalogError}
          onBack={() => tickers.setShowCatalog(false)}
          dict={dict}
        />
      ) : (
        <MonitoredTickersSection
          monitoredTickers={tickers.monitoredTickers}
          instruments={tickers.instruments}
          selectedTickers={tickers.selectedTickers}
          onToggleTicker={tickers.toggleTicker}
          onBrowseCatalog={() => tickers.setShowCatalog(true)}
          onRetryBackfill={tickers.retryTicker}
          isDirty={tickers.isDirty}
          isSaving={tickers.isSaving}
          saveError={tickers.saveError}
          saveSuccess={tickers.saveSuccess}
          onSave={tickers.save}
          isLoading={tickers.isLoading}
          repairMode={tickers.repairMode}
          onRepairModeChange={tickers.setRepairMode}
          repairSelection={tickers.repairSelection}
          onToggleRepairSelection={tickers.toggleRepairSelection}
          onClearRepairSelection={tickers.clearRepairSelection}
          onSubmitRepairRequests={tickers.submitRepairRequests}
          isRepairSubmitting={tickers.isRepairSubmitting}
          repairMessage={tickers.repairMessage}
          repairError={tickers.repairError}
          suggestedRepairKeys={repairQuery.suggestedKeys}
          suggestedRepairTickers={repairQuery.suggestedTickers}
          dict={dict}
        />
      )}
    </div>
  );
}

interface TickerRepairQuery {
  fromDataHealth: boolean;
  open: boolean;
  returnTo: string | null;
  suggestedKeys: Set<string>;
  suggestedLabels: string[];
  suggestedTickers: Set<string>;
}

function parseTickerRepairQuery(params: URLSearchParams): TickerRepairQuery {
  const open = params.get("repair") === "1" || params.get("repair") === "valuation";
  const fromDataHealth = params.get("origin") === "data-health";
  const market = params.get("market")?.trim() || null;
  const tickers = (params.get("tickers") ?? "")
    .split(",")
    .map((ticker) => ticker.trim())
    .filter(Boolean);
  const suggestedKeys = new Set(market ? tickers.map((ticker) => `${ticker}|${market}`) : []);
  const suggestedLabels = tickers.map((ticker) => (market ? `${ticker} · ${market}` : ticker));
  return {
    fromDataHealth,
    open,
    returnTo: normalizeLocalReturnTo(params.get("returnTo")),
    suggestedKeys,
    suggestedLabels,
    suggestedTickers: new Set(tickers),
  };
}

function normalizeLocalReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
    return decoded;
  } catch {
    return null;
  }
}
