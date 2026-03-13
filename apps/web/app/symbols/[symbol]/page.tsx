import Link from "next/link";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../../lib/utils";

interface SymbolHistoryPageProps {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ accountId?: string }>;
}

export default async function SymbolHistoryPage({ params, searchParams }: SymbolHistoryPageProps) {
  const [{ symbol: rawSymbol }, { accountId }] = await Promise.all([params, searchParams]);
  const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();
  const scopedAccountId = accountId?.trim() ? accountId.trim() : undefined;

  const [dashboard, transactions] = await Promise.all([
    fetchDashboardSnapshot(),
    fetchTransactionHistory({ symbol, accountId: scopedAccountId }),
  ]);

  const locale = dashboard.settings?.locale ?? "en";
  const dict = getDictionary(locale);
  const latestTrade = transactions[0] ?? null;
  const realizedPnlTotal = transactions.reduce((sum, transaction) => sum + (transaction.realizedPnlAmount ?? 0), 0);

  return (
    <div className="app-shell relative min-h-screen min-w-0 overflow-x-hidden">
      <main className="relative mx-auto min-w-0 w-full max-w-7xl px-4 py-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
        <section className="glass-panel rounded-[30px] px-5 py-6 shadow-glass sm:px-6 sm:py-7 md:px-8" data-testid="symbol-history-section">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-500/78">{dict.symbolHistory.eyebrow}</p>
              <h1 className="mt-3 text-3xl leading-tight text-slate-950 sm:text-4xl" data-testid="symbol-history-title">
                {symbol}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">{dict.symbolHistory.description}</p>
            </div>
            <Link
              href="/portfolio"
              className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              {dict.symbolHistory.backToDashboard}
            </Link>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <HistoryStat
              label={dict.symbolHistory.accountScopeLabel}
              value={scopedAccountId ?? dict.symbolHistory.allAccountsLabel}
              testId="symbol-history-account-scope"
            />
            <HistoryStat
              label={dict.symbolHistory.entriesLabel}
              value={formatNumber(transactions.length, locale)}
            />
            <HistoryStat
              label={dict.symbolHistory.realizedPnlLabel}
              value={formatCurrencyAmount(realizedPnlTotal, latestTrade?.realizedPnlCurrency ?? "TWD", locale)}
              detail={latestTrade?.tradeDate ? formatDateLabel(latestTrade.tradeDate, locale) : undefined}
            />
          </div>
        </section>

        <div className="mt-6">
          <TransactionHistoryTable transactions={transactions} dict={dict} locale={locale} />
        </div>
      </main>
    </div>
  );
}

function HistoryStat({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-[22px] border border-slate-200 bg-white/88 px-4 py-4 shadow-[0_12px_24px_rgba(148,163,184,0.08)]"
      data-testid={testId}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
      {detail ? <p className="mt-2 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}
