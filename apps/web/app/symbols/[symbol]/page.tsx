import Link from "next/link";
import { getDictionary } from "../../../lib/i18n";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";

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

  return (
    <div className="app-shell relative min-h-screen min-w-0 overflow-x-hidden">
      <main className="relative mx-auto min-w-0 w-full max-w-7xl px-4 py-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
        <section className="glass-panel rounded-[30px] px-5 py-6 shadow-glass sm:px-6 sm:py-7 md:px-8" data-testid="symbol-history-section">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{dict.symbolHistory.eyebrow}</p>
              <h1 className="mt-3 text-3xl leading-tight text-ink sm:text-4xl" data-testid="symbol-history-title">
                {symbol}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">{dict.symbolHistory.description}</p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:bg-white/10"
            >
              {dict.symbolHistory.backToDashboard}
            </Link>
          </div>

          <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            <span className="text-slate-400">{dict.symbolHistory.accountScopeLabel}</span>
            <span data-testid="symbol-history-account-scope">{scopedAccountId ?? dict.symbolHistory.allAccountsLabel}</span>
          </div>
        </section>

        <div className="mt-6">
          <TransactionHistoryTable transactions={transactions} dict={dict} locale={locale} />
        </div>
      </main>
    </div>
  );
}
