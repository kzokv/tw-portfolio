import type { LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Card } from "../ui/Card";
import type { Holding } from "./types";

interface HoldingsTableProps {
  holdings: Holding[];
  dict: AppDictionary;
  locale: LocaleCode;
}

function formatNtd(value: number, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function HoldingsTable({ holdings, dict, locale }: HoldingsTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl text-ink sm:text-2xl">{dict.holdings.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{dict.holdings.description}</p>
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{dict.holdings.entries(holdings.length)}</p>
      </div>

      <div className="overflow-x-auto rounded-[20px] border border-white/10 bg-slate-950/35" data-testid="holdings-table">
        <table className="min-w-full border-collapse text-sm text-slate-200">
            <thead>
              <tr className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                <th className="px-4 py-3 text-left font-medium">
                  <span className="flex items-center gap-1">
                    {dict.holdings.accountTerm}
                    <TooltipInfo
                      label={dict.holdings.accountTerm}
                      content={dict.tooltips.holdingsAccount}
                      triggerTestId="tooltip-holdings-account-trigger"
                      contentTestId="tooltip-holdings-account-content"
                    />
                  </span>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <span className="flex items-center gap-1">
                    {dict.holdings.symbolTerm}
                    <TooltipInfo
                      label={dict.holdings.symbolTerm}
                      content={dict.tooltips.holdingsSymbol}
                      triggerTestId="tooltip-holdings-symbol-trigger"
                      contentTestId="tooltip-holdings-symbol-content"
                    />
                  </span>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <span className="flex items-center gap-1">
                    {dict.holdings.quantityTerm}
                    <TooltipInfo
                      label={dict.holdings.quantityTerm}
                      content={dict.tooltips.holdingsQuantity}
                      triggerTestId="tooltip-holdings-quantity-trigger"
                      contentTestId="tooltip-holdings-quantity-content"
                    />
                  </span>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    {dict.holdings.totalCostTerm}
                    <TooltipInfo
                      label={dict.holdings.totalCostTerm}
                      content={dict.tooltips.holdingsTotalCost}
                      triggerTestId="tooltip-holdings-total-cost-trigger"
                      contentTestId="tooltip-holdings-total-cost-content"
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={`${holding.accountId}-${holding.symbol}`} className="border-b border-white/8 last:border-0">
                  <td className="px-4 py-3.5">{holding.accountId}</td>
                  <td className="px-4 py-3.5 font-semibold tracking-[0.16em] text-slate-50">{holding.symbol}</td>
                  <td className="px-4 py-3.5">{holding.quantity}</td>
                  <td className="px-4 py-3.5 text-right font-medium">{formatNtd(holding.costNtd, locale)}</td>
                </tr>
              ))}
            </tbody>
        </table>
      </div>
    </Card>
  );
}
