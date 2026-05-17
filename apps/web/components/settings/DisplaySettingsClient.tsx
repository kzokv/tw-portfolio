"use client";

import { useCallback } from "react";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { DisplayTabSection, type ReorderablePage } from "./DisplayTabSection";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";

/**
 * `/settings/display` — theme · accent · density · timeframes · reporting
 * currency · layout reset.
 *
 * Locale + Quote Poll Interval previously lived here (per spec §12 A5 they
 * were merged in from the retired `/settings/general` route). The
 * /settings/general route was restored on 2026-05-17; both fields now live
 * there again and this client renders only the visual/display block.
 */
export function DisplaySettingsClient() {
  const { locale } = useSettingsRouteContext();
  const dict = getDictionary(locale);
  const { refetch: refetchRanges } = useEffectiveRanges();

  const onTimeframesSaved = useCallback(() => {
    void refetchRanges();
  }, [refetchRanges]);

  const onReportingCurrencySaved = useCallback(() => {
    // Dashboard surfaces fetch on next visit; no-op from /settings route.
  }, []);

  return (
    <div className="space-y-6" data-testid="settings-section-display">
      <DisplayTabSection
        dict={dict}
        onTimeframesSaved={onTimeframesSaved}
        onLayoutReset={() => undefined}
        onPageLayoutReset={(_page: ReorderablePage) => undefined}
        onReportingCurrencySaved={onReportingCurrencySaved}
      />
    </div>
  );
}
