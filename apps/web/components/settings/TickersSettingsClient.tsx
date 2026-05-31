"use client";

import { useMemo } from "react";
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
  const dict = getDictionary(locale);
  const tickers = useMonitoredTickers(true);

  const positionTickerKeys = useMemo(
    () =>
      new Set(
        tickers.monitoredTickers
          .filter((s) => s.source === "position")
          .map((s) => `${s.ticker}|${s.marketCode}`),
      ),
    [tickers.monitoredTickers],
  );

  return (
    <div className="space-y-4" data-testid="settings-section-tickers">
      {tickers.showCatalog ? (
        <InstrumentCatalogSheet
          instruments={tickers.instruments}
          selectedTickers={tickers.selectedTickers}
          positionTickers={positionTickerKeys}
          onToggleTicker={tickers.toggleTicker}
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
          dict={dict}
        />
      )}
    </div>
  );
}
