"use client";

import Link from "next/link";
import type { LocaleCode, ValuationHealthDto, ValuationHealthHoldingAction } from "@vakwen/shared-types";
import { Badge } from "../ui/shadcn/badge";
import { Button } from "../ui/Button";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { cn, formatCurrencyAmount, formatDateLabel, formatPercent } from "../../lib/utils";

interface ValuationHealthPanelProps {
  adminRepairHref?: string | null;
  className?: string;
  locale: LocaleCode;
  showAdminActions?: boolean;
  valuationHealth: ValuationHealthDto | null | undefined;
}

export function ValuationHealthPanel({
  adminRepairHref = null,
  className,
  locale,
  showAdminActions = false,
  valuationHealth,
}: ValuationHealthPanelProps) {
  if (!valuationHealth) return null;

  const copy = valuationHealthCopy(locale);
  const hasBackfillAction = valuationHealth.recommendedActions.includes("run_backfill");
  const hasSnapshotRepairAction = valuationHealth.recommendedActions.includes("run_snapshot_repair");
  const hasRepairRecommendation = hasBackfillAction || hasSnapshotRepairAction;
  const hasAdminRepairAction = showAdminActions && adminRepairHref && hasRepairRecommendation;
  const deltaPercent = valuationHealth.relativeDeltaBps === null
    ? null
    : valuationHealth.relativeDeltaBps / 10_000;

  return (
    <section
      className={cn("rounded-xl border border-border/80 bg-muted/20 p-4", className)}
      data-testid="valuation-health-panel"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{copy.title}</p>
            <Badge variant={badgeVariantForStatus(valuationHealth.status)}>
              {statusLabel(copy, valuationHealth.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {explanationForReason(copy, valuationHealth.reason)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {copy.snapshotOnly}
          </p>
        </div>
        <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:min-w-[21rem]">
          <MetricRow
            label={copy.currentValue}
            value={formatMaybeCurrency(valuationHealth.currentValueAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.chartValue}
            value={formatMaybeCurrency(valuationHealth.snapshotValueAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.delta}
            value={formatMaybeCurrency(valuationHealth.deltaAmount, valuationHealth.reportingCurrency, locale, copy)}
          />
          <MetricRow
            label={copy.relativeDelta}
            value={deltaPercent === null ? copy.unavailable : formatPercent(deltaPercent, locale)}
          />
          <MetricRow
            label={copy.latestBarAsOf}
            value={formatMaybeDate(valuationHealth.latestBarAsOf, locale, copy)}
          />
          <MetricRow
            label={copy.latestSnapshotDate}
            value={formatMaybeDate(valuationHealth.latestSnapshotDate, locale, copy)}
          />
        </div>
      </div>

      {valuationHealth.affectedHoldings.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background" data-testid="valuation-health-holdings">
          <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            {copy.affectedHoldings}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{copy.ticker}</th>
                  <th className="px-4 py-2.5">{copy.currentValue}</th>
                  <th className="px-4 py-2.5">{copy.latestBarAsOf}</th>
                  <th className="px-4 py-2.5">{copy.latestSnapshotDate}</th>
                  <th className="px-4 py-2.5">{copy.status}</th>
                  {showAdminActions ? <th className="px-4 py-2.5">{copy.action}</th> : null}
                </tr>
              </thead>
              <tbody>
                {valuationHealth.affectedHoldings.map((holding) => (
                  <tr key={`${holding.marketCode}:${holding.ticker}`} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-foreground">{holding.ticker} · {holding.marketCode}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatMaybeCurrency(holding.currentReportingValueAmount, valuationHealth.reportingCurrency, locale, copy)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(holding.latestBarDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatMaybeDate(holding.latestSnapshotDate, locale, copy)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{holdingStatusLabel(copy, holding.status)}</td>
                    {showAdminActions ? (
                      <td className="px-4 py-3 text-muted-foreground">{holdingActionLabel(copy, holding.recommendedAction)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        {showAdminActions ? (
          <p className="text-sm text-muted-foreground">
            {copy.adminHelp}
          </p>
        ) : (
          <Alert data-testid="valuation-health-user-tip">
            <AlertTitle>{hasRepairRecommendation ? copy.userRepairTipTitle : copy.userInfoTipTitle}</AlertTitle>
            <AlertDescription>{hasRepairRecommendation ? copy.userRepairHelp : copy.userInfoHelp}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {hasAdminRepairAction ? (
            <Button asChild size="sm" data-testid="valuation-health-admin-repair">
              <Link href={adminRepairHref}>
                {hasBackfillAction && hasSnapshotRepairAction
                  ? copy.adminRepairAction
                  : hasSnapshotRepairAction
                    ? copy.snapshotRepairAction
                    : copy.backfillAction}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground">{value}</div>
    </div>
  );
}

function formatMaybeCurrency(
  value: number | null,
  currency: string,
  locale: LocaleCode,
  copy: ReturnType<typeof valuationHealthCopy>,
): string {
  return value === null ? copy.unavailable : formatCurrencyAmount(value, currency, locale);
}

function formatMaybeDate(value: string | null, locale: LocaleCode, copy: ReturnType<typeof valuationHealthCopy>): string {
  return value ? formatDateLabel(value, locale) : copy.unavailable;
}

function badgeVariantForStatus(status: ValuationHealthDto["status"]) {
  if (status === "healthy") return "secondary" as const;
  if (status === "material") return "outline" as const;
  return "secondary" as const;
}

function statusLabel(copy: ReturnType<typeof valuationHealthCopy>, status: ValuationHealthDto["status"]): string {
  if (status === "healthy") return copy.healthy;
  if (status === "material") return copy.material;
  return copy.unavailable;
}

function explanationForReason(copy: ReturnType<typeof valuationHealthCopy>, reason: ValuationHealthDto["reason"]): string {
  switch (reason) {
    case "within_minor_unit_tolerance":
      return copy.withinTolerance;
    case "within_threshold":
      return copy.withinThreshold;
    case "absolute_threshold_exceeded":
      return copy.absoluteExceeded;
    case "relative_threshold_exceeded":
      return copy.relativeExceeded;
    case "missing_current_value":
      return copy.missingCurrentValue;
    case "missing_snapshot_value":
      return copy.missingSnapshotValue;
  }
}

function holdingStatusLabel(
  copy: ReturnType<typeof valuationHealthCopy>,
  status: ValuationHealthDto["affectedHoldings"][number]["status"],
): string {
  switch (status) {
    case "healthy":
      return copy.healthy;
    case "missing_latest_bar":
      return copy.missingLatestBar;
    case "backfill_pending":
      return copy.backfillPending;
    case "backfill_failed":
      return copy.backfillFailed;
    case "missing_snapshot":
      return copy.missingSnapshot;
    case "stale_snapshot":
      return copy.staleSnapshot;
  }
}

function holdingActionLabel(
  copy: ReturnType<typeof valuationHealthCopy>,
  action: ValuationHealthHoldingAction,
): string {
  switch (action) {
    case "none":
      return copy.none;
    case "wait_for_backfill":
      return copy.waitForBackfill;
    case "run_backfill":
      return copy.backfillAction;
    case "run_snapshot_repair":
      return copy.snapshotRepairAction;
  }
}

function valuationHealthCopy(locale: LocaleCode) {
  if (locale === "zh-TW") {
    return {
      absoluteExceeded: "目前市值與最新可用快照的差距已超過絕對門檻。",
      action: "建議處理",
      adminHelp: "管理員可開啟受影響標的的修復流程，從市場資料回補後接續處理快照修復。",
      adminRepairAction: "開啟管理員修復流程",
      affectedHoldings: "影響最新估值的持倉",
      backfillAction: "執行管理員回補",
      backfillFailed: "回補失敗",
      backfillPending: "回補中",
      chartValue: "圖表市值",
      currentValue: "目前市值",
      delta: "差額",
      healthy: "正常",
      latestBarAsOf: "最新價格日期",
      latestSnapshotDate: "最新快照日期",
      material: "差異顯著",
      missingCurrentValue: "目前估值尚未可用，暫時無法比較。",
      missingLatestBar: "缺少最新價格",
      missingSnapshot: "缺少快照",
      missingSnapshotValue: "圖表使用的最新快照點尚未可用。",
      none: "無",
      relativeDelta: "相對差額",
      relativeExceeded: "目前市值與最新可用快照的差距已超過相對門檻。",
      snapshotOnly: "圖表維持快照來源，不會把即時持倉值灌進歷史點位。",
      snapshotRepairAction: "修復快照",
      staleSnapshot: "快照過期",
      status: "狀態",
      ticker: "標的",
      title: "估值健康度",
      unavailable: "無法顯示",
      userInfoHelp: "目前估值與快照來源已在設定門檻內；此面板僅說明圖表值的資料來源。",
      userInfoTipTitle: "不需處理",
      userRepairHelp: "此處不提供修復操作。若差距持續存在，請等待市場資料完成後再重新整理，或請管理員處理回補與快照修復。",
      userRepairTipTitle: "需要管理員修復",
      waitForBackfill: "等待回補",
      withinThreshold: "目前市值與圖表最新快照仍在允許門檻內。",
      withinTolerance: "差異僅屬四捨五入容忍範圍。",
    };
  }

  return {
    absoluteExceeded: "Current valuation and the latest usable snapshot diverge beyond the absolute threshold.",
    action: "Recommended action",
    adminHelp: "Admins can open the affected-holdings repair flow and follow market-data remediation with targeted snapshot repair.",
    adminRepairAction: "Open admin repair",
    affectedHoldings: "Holdings affecting latest valuation freshness",
    backfillAction: "Run admin backfill",
    backfillFailed: "Backfill failed",
    backfillPending: "Backfill pending",
    chartValue: "Chart valuation",
    currentValue: "Current valuation",
    delta: "Delta",
    healthy: "Healthy",
    latestBarAsOf: "Latest bar date",
    latestSnapshotDate: "Latest snapshot date",
    material: "Material gap",
    missingCurrentValue: "Current valuation is unavailable, so the gap cannot be compared yet.",
    missingLatestBar: "Missing latest bar",
    missingSnapshot: "Missing snapshot",
    missingSnapshotValue: "The latest snapshot-backed chart point is unavailable.",
    none: "None",
    relativeDelta: "Relative delta",
    relativeExceeded: "Current valuation and the latest usable snapshot diverge beyond the relative threshold.",
    snapshotOnly: "Charts stay snapshot-only and do not inject live holdings into historical points.",
    snapshotRepairAction: "Repair snapshots",
    staleSnapshot: "Stale snapshot",
    status: "Status",
    ticker: "Ticker",
    title: "Valuation health",
    unavailable: "Unavailable",
    userInfoHelp: "Current valuation and snapshot-backed chart values are within the configured threshold; this panel explains the chart data source.",
    userInfoTipTitle: "No action needed",
    userRepairHelp: "No repair action is available here. If the gap persists, wait for market data to settle and refresh again, or ask an admin to repair the affected holdings.",
    userRepairTipTitle: "Admin repair required",
    waitForBackfill: "Wait for backfill",
    withinThreshold: "Current valuation and the latest chart snapshot are still within the configured threshold.",
    withinTolerance: "The difference is only within minor-unit rounding tolerance.",
  };
}
