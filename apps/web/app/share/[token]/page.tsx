import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PublicShareHoldingGroupDto, PublicShareViewDto } from "@vakwen/shared-types";
import { Card } from "../../../components/ui/Card";
import { buttonVariants } from "../../../components/ui/Button";
import { ThemeToggle } from "../../../components/layout/ThemeToggle";
import {
  HoldingsGridDesktopFrame,
  HoldingsGridEmptyState,
  HoldingsGridNativeTable,
} from "../../../components/holdings/HoldingsGrid";
import { API_BASE } from "../../../lib/api";
import { resolveAuthLocale } from "../../../lib/authPages";
import { getDictionary } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
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

type PublicShareHoldingRow = Omit<PublicShareHoldingGroupDto, "marketCode"> & {
  marketCode: string;
};

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

  const holdings: PublicShareHoldingRow[] = Array.isArray((view as PublicShareViewDto & { holdingGroups?: PublicShareViewDto["holdingGroups"] }).holdingGroups)
    ? view.holdingGroups
    : view.holdings.map((row) => ({
        ticker: row.ticker,
        instrumentName: row.instrumentName ?? null,
        marketCode: "UNKNOWN",
        quantity: row.quantity,
        accountCount: 1,
        marketValueAmount: row.marketValueAmount,
        marketValueCurrency: row.marketValueCurrency,
        allocationPercent: row.allocationPercent,
        quoteStatus: row.quoteStatus ?? "current",
      }));
  const summaryValues = view.summary.totalValueByCurrency;
  const summaryReturns = view.summary.returnByCurrency;

  const ownerName = view.ownerDisplayName || copy.ownerFallback;

  return (
    <main className="min-h-screen bg-background" data-testid="public-share-root">
      {/* Phase 5c — slim visitor-chrome top strip per design §8 #6.
          "Shared by {ownerName} · Powered by Vakwen" on a tight band
          above all body content. */}
      <div
        className="border-b border-border bg-muted/40 px-4 py-2"
        data-testid="public-share-top-strip"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span data-testid="public-share-top-strip-shared-by">
            {copy.topStripSharedBy.replace("{name}", ownerName)}
          </span>
          <div className="flex items-center gap-2">
            <span data-testid="public-share-top-strip-powered-by">
              {copy.topStripPoweredBy}
            </span>
            <ThemeToggle className="h-8" />
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-12">
        <Card className="space-y-5" data-testid="public-share-header">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{copy.eyebrow}</p>
          <h1 className="text-balance text-3xl font-semibold text-foreground" data-testid="public-share-owner-name">
            <span data-testid="public-share-owner">
              {copy.sharedBy.replace("{name}", view.ownerDisplayName || copy.ownerFallback)}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="public-share-meta">
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
              className="rounded-[22px] border border-border bg-muted/30 px-5 py-4"
              data-testid="public-share-summary-total"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.totalValueLabel}
              </p>
              <ul className="mt-2 space-y-1">
                {summaryValues.map((row) => (
                  <li
                    key={row.currency}
                    className="text-lg font-semibold text-foreground"
                    data-testid={`public-share-total-${row.currency}`}
                  >
                    {formatCurrencyAmount(row.amount, row.currency, locale)}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="rounded-[22px] border border-border bg-muted/30 px-5 py-4"
              data-testid="public-share-summary-return"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.returnLabel}
              </p>
              <ul className="mt-2 space-y-1">
                {summaryReturns.map((row) => (
                  <li
                    key={row.currency}
                    className="text-lg font-semibold text-foreground"
                    data-testid={`public-share-return-${row.currency}`}
                  >
                    <span className="text-xs font-medium text-muted-foreground">{row.currency}</span>{" "}
                    {formatPercent(row.returnPercent, locale)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        <Card className="space-y-4" data-testid="public-share-holdings">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{copy.holdingsTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.holdingsSubtitle.replace("{count}", String(holdings.length))}
            </p>
            {view.dataHealth?.missingQuoteCount ? (
              <p
                className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
                data-testid="public-share-data-health-warning"
              >
                {copy.dataHealthWarning.replace("{count}", String(view.dataHealth.missingQuoteCount))}
              </p>
            ) : null}
          </div>

          {holdings.length === 0 ? (
            <HoldingsGridEmptyState className="rounded-[20px] bg-muted/30 py-6" testId="public-share-empty">
              {copy.holdingsEmpty}
            </HoldingsGridEmptyState>
          ) : (
            <HoldingsGridDesktopFrame className="block overflow-x-auto rounded-xl bg-card">
              <HoldingsGridNativeTable className="min-w-[36rem] table-auto" testId="public-share-holdings-table">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colTicker}
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colMarket}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colAccounts}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colShares}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colMarketValue}
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {copy.colAllocation}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {holdings.map((row) => (
                    <tr key={`${row.ticker}-${row.marketCode}`} data-testid={`public-share-holding-${row.ticker}-${row.marketCode}`}>
                      <td
                        className="px-4 py-3 text-sm font-medium text-foreground"
                        data-testid={`public-share-holding-group-${row.ticker}-${row.marketCode}`}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span>{row.ticker}</span>
                          {row.instrumentName ? <span className="text-xs font-normal text-muted-foreground">{row.instrumentName}</span> : null}
                        </div>
                        {row.quoteStatus === "missing" ? (
                          <span
                            className="ml-2 inline-flex rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning"
                            data-testid={`public-share-holding-quote-status-${row.ticker}-${row.marketCode}`}
                          >
                            {copy.quoteMissingLabel}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.marketCode === "UNKNOWN" ? "-" : row.marketCode}
                      </td>
                      <td
                        className="px-4 py-3 text-right text-sm text-muted-foreground"
                        data-testid={`public-share-holding-accounts-${row.ticker}-${row.marketCode}`}
                      >
                        {formatNumber(row.accountCount, locale)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {formatNumber(row.quantity, locale, 4)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {row.marketValueAmount === null
                          ? copy.unavailableValue
                          : formatCurrencyAmount(row.marketValueAmount, row.marketValueCurrency, locale)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted-foreground">
                        {row.allocationPercent === null
                          ? copy.unavailableValue
                          : formatPercent(row.allocationPercent, locale, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </HoldingsGridNativeTable>
            </HoldingsGridDesktopFrame>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground" data-testid="public-share-disclosure">
          {copy.footerDisclosure}
        </p>

        {/* Phase 5c — footer CTA per design §8 #6. */}
        <div className="flex justify-center">
          <Link
            href="/login"
            data-testid="public-share-signup-cta"
            className={cn(buttonVariants({ variant: "default" }))}
          >
            {copy.signUpCta}
          </Link>
        </div>
      </div>
    </main>
  );
}
