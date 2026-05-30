"use client";

import type { AppDictionary } from "../../lib/i18n";
import { TooltipInfo } from "../ui/TooltipInfo";
import type { FxTransferEstimate } from "../../features/fx-transfer/services/fxTransferService";

interface FxRateGaugeProps {
  estimate: FxTransferEstimate | null;
  effectiveRate: number;
  dict: AppDictionary;
}

function markerOffset(estimate: FxTransferEstimate | null, effectiveRate: number): number {
  if (!estimate?.midRate || effectiveRate <= 0) return 50;
  const signedPct = ((effectiveRate - estimate.midRate) / estimate.midRate) * 100;
  const capped = Math.max(-12, Math.min(12, signedPct));
  return 50 + (capped / 12) * 44;
}

function stateCopy(estimate: FxTransferEstimate | null, dict: AppDictionary): string {
  const d = dict.cashLedger;
  if (!estimate?.midRateAvailable) return d.fxGaugeNoMidRate;
  if (estimate.toleranceState === "block") return d.fxGaugeBlock;
  if (estimate.toleranceState === "warn") return d.fxGaugeWarn;
  return d.fxGaugeSafe;
}

export function FxRateGauge({ estimate, effectiveRate, dict }: FxRateGaugeProps) {
  const d = dict.cashLedger;
  const offset = markerOffset(estimate, effectiveRate);
  const toleranceText = estimate?.tolerancePct === null || estimate?.tolerancePct === undefined
    ? d.fxGaugeNoMidRate
    : d.fxGaugeSpread
      .replace("{spread}", estimate.tolerancePct.toFixed(2))
      .replace("{mid}", estimate.midRate?.toFixed(6) ?? "—")
      .replace("{rate}", effectiveRate > 0 ? effectiveRate.toFixed(6) : "—");

  return (
    <div className="space-y-2" data-testid="fx-rate-gauge">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        <span>{d.fxGaugeLabel}</span>
        <TooltipInfo
          label={d.fxGaugeLabel}
          content={toleranceText}
          triggerTestId="fx-rate-gauge-tooltip-trigger"
          contentTestId="fx-rate-gauge-tooltip-content"
        />
      </div>
      <svg
        viewBox="0 0 100 18"
        role="img"
        aria-label={stateCopy(estimate, dict)}
        className="h-9 w-full overflow-visible"
      >
        <rect x="6" y="7" width="22" height="4" rx="2" className="fill-emerald-300" />
        <rect x="28" y="7" width="44" height="4" rx="2" className="fill-amber-300" />
        <rect x="72" y="7" width="22" height="4" rx="2" className="fill-rose-300" />
        <line x1="50" x2="50" y1="4" y2="14" className="stroke-slate-500" strokeWidth="0.8" />
        <circle
          cx={offset}
          cy="9"
          r="4"
          className={`transition-[cx] duration-200 ${
            estimate?.toleranceState === "block"
              ? "fill-rose-600"
              : estimate?.toleranceState === "warn"
                ? "fill-amber-600"
                : "fill-emerald-600"
          }`}
        />
      </svg>
      <p className="text-xs text-slate-500">{stateCopy(estimate, dict)}</p>
    </div>
  );
}
