"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import type { LocaleCode, PostedTransactionMutationRunDto } from "@vakwen/shared-types";
import { getPostedTransactionMutationRun } from "../../features/portfolio/services/transactionMutationService";
import { formatDateLabel, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

const COPY = {
  en: {
    title: "Posted transaction mutation run",
    subtitle: "Core accounting is committed separately from the durable rebuild status.",
    status: "Run status",
    rebuild: "Rebuild",
    transactions: "Affected transactions",
    accounts: "Accounts",
    tickers: "Tickers",
    created: "Created",
    completed: "Completed",
    scopes: "Affected scopes",
    account: "Account",
    ticker: "Ticker",
    fromDate: "Rebuild from",
    scopeStatus: "Status",
    preview: "Open preview",
    transactionsLink: "Open transactions",
    refresh: "Refresh status",
    refreshFailed: "Could not refresh the mutation run.",
  },
  "zh-TW": {
    title: "已入帳交易異動執行狀態",
    subtitle: "核心帳務提交與耐久重建狀態會分開顯示。",
    status: "執行狀態",
    rebuild: "重建狀態",
    transactions: "受影響交易",
    accounts: "帳戶",
    tickers: "代號",
    created: "建立時間",
    completed: "完成時間",
    scopes: "受影響範圍",
    account: "帳戶",
    ticker: "代號",
    fromDate: "重建起始日",
    scopeStatus: "狀態",
    preview: "開啟預覽",
    transactionsLink: "開啟交易",
    refresh: "重新整理狀態",
    refreshFailed: "無法重新整理異動執行狀態。",
  },
} as const;

const TERMINAL_STATUSES = new Set(["completed", "partially_failed", "failed"]);

function statusTone(status: PostedTransactionMutationRunDto["status"] | PostedTransactionMutationRunDto["rebuildStatus"]) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed" || status === "partially_failed") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

export function PostedTransactionMutationRunClient({
  initialRun,
  locale,
}: {
  initialRun: PostedTransactionMutationRunDto;
  locale: LocaleCode;
}) {
  const copy = COPY[locale];
  const [run, setRun] = useState(initialRun);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setRun(await getPostedTransactionMutationRun(run.runId));
    } catch {
      setError(copy.refreshFailed);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (TERMINAL_STATUSES.has(run.rebuildStatus)) return;
    const timer = window.setTimeout(() => { void refresh(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [run.rebuildStatus, run.runId]);

  return (
    <div className="grid min-w-0 gap-6 overflow-x-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold text-slate-950 sm:text-3xl">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.subtitle}</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
            {copy.refresh}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href={run.deepLinks.previewPath}>{copy.preview}<ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href={run.deepLinks.transactionPath}>{copy.transactionsLink}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <RunMetric label={copy.status} value={run.status} tone={statusTone(run.status)} />
        <RunMetric label={copy.rebuild} value={run.rebuildStatus} tone={statusTone(run.rebuildStatus)} />
        <RunMetric label={copy.accounts} value={formatNumber(run.affectedAccountIds.length, locale)} />
        <RunMetric label={copy.tickers} value={formatNumber(run.affectedTickers.length, locale)} />
      </div>

      <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p>{copy.created}: {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.createdAt))}</p>
        <p>{copy.completed}: {run.completedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.completedAt)) : "-"}</p>
      </div>

      {[...run.errors.map((item) => item.message), ...run.blockers, ...run.warnings].length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="grid gap-1">
              {[...run.errors.map((item) => item.message), ...run.blockers, ...run.warnings].map((message) => <p key={message}>{message}</p>)}
            </div>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-rose-700" role="alert">{error}</p> : null}

      <section aria-labelledby="mutation-run-scopes">
        <h2 id="mutation-run-scopes" className="text-lg font-semibold text-slate-950">{copy.scopes}</h2>
        <div className="mt-3 hidden max-w-full overflow-x-auto rounded-lg border border-slate-200 md:block">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2">{copy.account}</th>
                <th className="px-3 py-2">{copy.ticker}</th>
                <th className="px-3 py-2">{copy.fromDate}</th>
                <th className="px-3 py-2">{copy.scopeStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {run.scopes.map((scope) => (
                <tr key={`${scope.accountId}:${scope.ticker}:${scope.marketCode}`}>
                  <td className="px-3 py-3">{scope.accountName}</td>
                  <td className="px-3 py-3 font-medium text-slate-950">{scope.ticker} · {scope.marketCode}</td>
                  <td className="px-3 py-3">{formatDateLabel(scope.earliestReplayDate, locale)}</td>
                  <td className="px-3 py-3">
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", statusTone(scope.status ?? "queued"))}>
                      {scope.status ?? "queued"}
                    </span>
                    {scope.errorMessage ? <p className="mt-1 text-xs text-rose-700">{scope.errorMessage}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-3 md:hidden">
          {run.scopes.map((scope) => (
            <article key={`${scope.accountId}:${scope.ticker}:${scope.marketCode}`} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{scope.ticker} · {scope.marketCode}</p>
                  <p className="mt-1 text-slate-600">{scope.accountName}</p>
                </div>
                <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", statusTone(scope.status ?? "queued"))}>
                  {scope.status ?? "queued"}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">{copy.fromDate}</p>
              <p className="mt-1 font-medium text-slate-900">{formatDateLabel(scope.earliestReplayDate, locale)}</p>
              {scope.errorMessage ? <p className="mt-2 text-xs text-rose-700">{scope.errorMessage}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function RunMetric({ label, tone, value }: { label: string; tone?: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold text-slate-950", tone && "inline-flex rounded-full border px-2 py-0.5", tone)}>
        {tone === "border-emerald-200 bg-emerald-50 text-emerald-800" ? <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> : null}
        {value}
      </p>
    </div>
  );
}
