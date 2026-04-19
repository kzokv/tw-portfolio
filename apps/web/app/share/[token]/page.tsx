import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { PublicShareViewDto } from "@tw-portfolio/shared-types";
import { Card } from "../../../components/ui/Card";
import { API_BASE } from "../../../lib/api";
import { resolveAuthLocale } from "../../../lib/authPages";
import { getDictionary } from "../../../lib/i18n";
import {
  formatCurrencyAmount,
  formatDateLabel,
  formatNumber,
  formatPercent,
} from "../../../lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio snapshot",
  robots: { index: false, follow: false },
  openGraph: { title: "Portfolio snapshot" },
};

interface PublicSharePageProps {
  params: Promise<{ token: string }>;
}

async function fetchPublicShare(token: string): Promise<PublicShareViewDto | null> {
  const response = await fetch(`${API_BASE}/share/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) return null;
  return (await response.json()) as PublicShareViewDto;
}

export default async function PublicSharePage({ params }: PublicSharePageProps) {
  const [{ token }, headerStore] = await Promise.all([params, headers()]);
  const locale = resolveAuthLocale(headerStore.get("accept-language"));
  const dict = getDictionary(locale);
  const copy = dict.sharing.publicLinks.publicView;

  const view = await fetchPublicShare(token);
  if (!view) notFound();

  const holdings = view.holdings;
  const summaryValues = view.summary.totalValueByCurrency;
  const summaryReturns = view.summary.returnByCurrency;

  return (
    <main className="min-h-screen bg-bg px-4 py-12" data-testid="public-share-root">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Card className="space-y-5" data-testid="public-share-header">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{copy.eyebrow}</p>
          <h1 className="text-3xl font-semibold text-slate-950" data-testid="public-share-owner-name">
            <span data-testid="public-share-owner">
              {copy.sharedBy.replace("{name}", view.ownerDisplayName || copy.ownerFallback)}
            </span>
          </h1>
          <p className="text-sm text-slate-600" data-testid="public-share-meta">
            <span>{copy.readOnlyLabel}</span>
            <span aria-hidden="true"> · </span>
            <span data-testid="public-share-expires-at">
              {copy.expiresPrefix} {formatDateLabel(view.expiresAt, locale)}
            </span>
            {view.quoteAsOf ? (
              <>
                <span aria-hidden="true"> · </span>
                <span data-testid="public-share-quote-as-of">
                  {copy.quotePrefix} {formatDateLabel(view.quoteAsOf, locale)}
                </span>
              </>
            ) : null}
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div
              className="rounded-[22px] border border-slate-200 bg-white/80 px-5 py-4"
              data-testid="public-share-summary-total"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {copy.totalValueLabel}
              </p>
              <ul className="mt-2 space-y-1">
                {summaryValues.map((row) => (
                  <li
                    key={row.currency}
                    className="text-lg font-semibold text-slate-950"
                    data-testid={`public-share-total-${row.currency}`}
                  >
                    {formatCurrencyAmount(row.amount, row.currency, locale)}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="rounded-[22px] border border-slate-200 bg-white/80 px-5 py-4"
              data-testid="public-share-summary-return"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {copy.returnLabel}
              </p>
              <ul className="mt-2 space-y-1">
                {summaryReturns.map((row) => (
                  <li
                    key={row.currency}
                    className="text-lg font-semibold text-slate-950"
                    data-testid={`public-share-return-${row.currency}`}
                  >
                    <span className="text-xs font-medium text-slate-500">{row.currency}</span>{" "}
                    {formatPercent(row.returnPercent, locale)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        <Card className="space-y-4" data-testid="public-share-holdings">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{copy.holdingsTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {copy.holdingsSubtitle.replace("{count}", String(holdings.length))}
            </p>
          </div>

          {holdings.length === 0 ? (
            <p
              className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-600"
              data-testid="public-share-empty"
            >
              {copy.holdingsEmpty}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[36rem] text-sm" data-testid="public-share-holdings-table">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {copy.colTicker}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {copy.colShares}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {copy.colMarketValue}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {copy.colAllocation}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {holdings.map((row) => (
                    <tr key={row.ticker} data-testid={`public-share-holding-${row.ticker}`}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.ticker}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {formatNumber(row.quantity, locale, 4)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {formatCurrencyAmount(row.marketValueAmount, row.marketValueCurrency, locale)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {formatPercent(row.allocationPercent, locale, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-center text-xs text-slate-500" data-testid="public-share-disclosure">
          {copy.footerDisclosure}
        </p>
      </div>
    </main>
  );
}
