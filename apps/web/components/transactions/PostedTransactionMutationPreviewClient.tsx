"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Filter, ShieldAlert } from "lucide-react";
import type {
  LocaleCode,
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationPreviewItemDto,
  PostedTransactionMutationPreviewQueryDto,
} from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { getPostedTransactionMutationPreview } from "../../features/portfolio/services/transactionMutationService";

const COPY = {
  en: {
    title: "Posted transaction mutation preview",
    reviewOnly: "Review this preview here. Approval must be given in your AI conversation.",
    reason: "Reason",
    transactions: "Transactions",
    accounts: "Accounts",
    tickers: "Tickers",
    blockers: "Blockers",
    accountingImpact: "Accounting impact",
    quantity: "Quantity",
    costBasis: "Cost basis",
    realizedPnl: "Realized P&L",
    cash: "Cash",
    dividends: "Dividend reconciliation",
    reopened: "reopened",
    search: "Ticker",
    allAccounts: "All accounts",
    allChanges: "All changes",
    before: "Before",
    after: "After",
    impact: "Impact",
    warnings: "Warnings",
    manualReentry: "Manual re-entry or dividend follow-up may be required.",
    showing: "Showing {start}-{end} of {total}",
    previous: "Previous",
    next: "Next",
    expires: "Expires",
    stale: "Stale",
    expired: "Expired",
    confirmed: "Confirmed",
    failed: "Failed",
    ready: "Ready for confirmation",
    copyPreviewId: "Copy preview ID",
    viewAudit: "View full audit data",
    noItems: "No preview items match the current filters.",
    changed: "Changed",
    deleted: "Deleted",
    unchanged: "Unchanged",
    blocked: "Blocked",
    loading: "Loading…",
    loadFailed: "Preview load failed",
    tradeDate: "Trade date",
    quantityLabel: "Quantity",
    unitPrice: "Unit price",
    fees: "Fees",
    settlement: "Settlement",
    bookedCost: "Booked cost",
    unavailable: "Unavailable",
    noConfirm: "This page is inspection-only. Confirmation stays in the explicit web or AI flow.",
  },
  "zh-TW": {
    title: "已入帳交易異動預覽",
    reviewOnly: "請在此檢視預覽。核准必須在 AI 對話中明確給出。",
    reason: "原因",
    transactions: "交易",
    accounts: "帳戶",
    tickers: "代號",
    blockers: "阻擋項目",
    accountingImpact: "帳務影響",
    quantity: "數量",
    costBasis: "成本基礎",
    realizedPnl: "已實現損益",
    cash: "現金",
    dividends: "股利對帳",
    reopened: "重新開啟",
    search: "代號",
    allAccounts: "全部帳戶",
    allChanges: "全部變更",
    before: "變更前",
    after: "變更後",
    impact: "影響",
    warnings: "警告",
    manualReentry: "可能需要手動重新輸入或處理股利後續項目。",
    showing: "顯示 {start}-{end} / 共 {total}",
    previous: "上一頁",
    next: "下一頁",
    expires: "到期",
    stale: "已過時",
    expired: "已過期",
    confirmed: "已確認",
    failed: "失敗",
    ready: "可進入確認",
    copyPreviewId: "複製預覽 ID",
    viewAudit: "查看完整稽核資料",
    noItems: "目前篩選條件下沒有預覽項目。",
    changed: "已變更",
    deleted: "已刪除",
    unchanged: "未變更",
    blocked: "已阻擋",
    loading: "載入中…",
    loadFailed: "無法載入預覽",
    tradeDate: "交易日期",
    quantityLabel: "數量",
    unitPrice: "單價",
    fees: "費用",
    settlement: "結算",
    bookedCost: "入帳成本",
    unavailable: "無資料",
    noConfirm: "此頁僅供檢視。確認仍留在明確的網頁或 AI 流程中。",
  },
} as const;

function mutationStatusTone(status: PostedTransactionMutationPreviewDto["status"]) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "confirmed") return "border-sky-200 bg-sky-50 text-sky-800";
  if (status === "stale") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function itemStatusLabel(locale: LocaleCode, status: PostedTransactionMutationPreviewItemDto["status"]) {
  return COPY[locale][status];
}

function formatDelta(locale: LocaleCode, value: number, unit?: string) {
  const prefix = value > 0 ? "+" : "";
  const body = `${prefix}${formatNumber(value, locale)}`;
  return unit ? `${body} ${unit}` : body;
}

function formatExpiry(value: string, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PreviewFactBlock({
  locale,
  label,
  item,
  state,
}: {
  locale: LocaleCode;
  label: string;
  item: PostedTransactionMutationPreviewItemDto;
  state: "before" | "after";
}) {
  const facts = state === "before" ? item.before : item.after;
  if (!facts) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-sm text-slate-500">
        <p className="text-xs uppercase tracking-normal text-slate-500">{label}</p>
        <p className="mt-2">{COPY[locale].unavailable}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm">
      <p className="text-xs uppercase tracking-normal text-slate-500">{label}</p>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].tradeDate}</dt>
          <dd className="font-medium text-slate-900">{formatDateLabel(facts.tradeDate, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].quantityLabel}</dt>
          <dd className="font-medium text-slate-900">{formatNumber(facts.quantity, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].unitPrice}</dt>
          <dd className="font-medium text-slate-900">{formatCurrencyAmount(facts.unitPrice, facts.priceCurrency, locale)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].fees}</dt>
          <dd className="font-medium text-slate-900">
            {formatCurrencyAmount(facts.commissionAmount + facts.taxAmount, facts.priceCurrency, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].settlement}</dt>
          <dd className="font-medium text-slate-900">
            {facts.settlementAvailable && facts.settlementAmount !== null
              ? formatCurrencyAmount(facts.settlementAmount, facts.priceCurrency, locale)
              : COPY[locale].unavailable}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">{COPY[locale].bookedCost}</dt>
          <dd className="font-medium text-slate-900">
            {facts.bookedCostAmount !== null
              ? formatCurrencyAmount(facts.bookedCostAmount, facts.priceCurrency, locale)
              : COPY[locale].unavailable}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function PreviewFactSummary({
  item,
  locale,
  state,
}: {
  item: PostedTransactionMutationPreviewItemDto;
  locale: LocaleCode;
  state: "before" | "after";
}) {
  const facts = state === "before" ? item.before : item.after;
  if (!facts) return <span className="text-slate-500">{COPY[locale].unavailable}</span>;
  return (
    <dl className="grid gap-1 text-xs">
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{COPY[locale].tradeDate}</dt>
        <dd className="font-medium text-slate-900">{formatDateLabel(facts.tradeDate, locale)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{COPY[locale].quantityLabel}</dt>
        <dd className="font-medium text-slate-900">
          {formatNumber(facts.quantity, locale)} @ {formatCurrencyAmount(facts.unitPrice, facts.priceCurrency, locale)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{COPY[locale].fees}</dt>
        <dd className="font-medium text-slate-900">
          {formatCurrencyAmount(facts.commissionAmount + facts.taxAmount, facts.priceCurrency, locale)}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{COPY[locale].settlement}</dt>
        <dd className="font-medium text-slate-900">
          {facts.settlementAvailable && facts.settlementAmount !== null
            ? formatCurrencyAmount(facts.settlementAmount, facts.priceCurrency, locale)
            : COPY[locale].unavailable}
        </dd>
      </div>
    </dl>
  );
}

export function PostedTransactionMutationPreviewClient({
  initialPreview,
  locale,
  contextOwnerId = null,
}: {
  initialPreview: PostedTransactionMutationPreviewDto;
  locale: LocaleCode;
  contextOwnerId?: string | null;
}) {
  const copy = COPY[locale];
  const [preview, setPreview] = useState(initialPreview);
  const [tickerQuery, setTickerQuery] = useState("");
  const [accountId, setAccountId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accountOptions = useMemo(
    () => [...new Map(preview.scopes.map((scope) => [
      scope.accountId,
      { value: scope.accountId, label: scope.accountName },
    ])).values()],
    [preview.scopes],
  );

  const query = useMemo<PostedTransactionMutationPreviewQueryDto>(() => ({
    offset: preview.page.offset,
    limit: preview.page.limit,
    accountId: accountId === "all" ? undefined : accountId,
    ticker: tickerQuery.trim() || undefined,
    status: status === "all" ? undefined : status as PostedTransactionMutationPreviewQueryDto["status"],
  }), [accountId, preview.page.limit, preview.page.offset, status, tickerQuery]);

  async function load(next: PostedTransactionMutationPreviewQueryDto) {
    setBusy(true);
    setError("");
    try {
      setPreview(await getPostedTransactionMutationPreview(preview.previewId, next, contextOwnerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load({ ...query, offset: 0 });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [accountId, status, tickerQuery]);

  const startRow = preview.page.total === 0 ? 0 : preview.page.offset + 1;
  const endRow = Math.min(preview.page.offset + preview.page.items.length, preview.page.total);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.noConfirm}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(preview.previewId)}
          >
            <Copy className="h-4 w-4" />
            {copy.copyPreviewId}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href={preview.deepLinks.transactionPath}>
              {copy.viewAudit}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <Card className={cn("rounded-lg border px-4 py-4", mutationStatusTone(preview.status))}>
        <div className="flex items-start gap-3">
          {preview.status === "ready" || preview.status === "confirmed" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5" />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5" />
          )}
          <div>
            <p className="font-semibold">
              {preview.status === "ready"
                ? copy.ready
                : preview.status === "stale"
                  ? copy.stale
                  : preview.status === "expired"
                    ? copy.expired
                    : preview.status === "confirmed"
                      ? copy.confirmed
                      : copy.failed}
            </p>
            <p className="mt-1 text-sm">
              {copy.expires} {formatExpiry(preview.expiresAt, locale)} · {formatNumber(preview.page.total, locale)} {copy.transactions.toLowerCase()}
            </p>
          </div>
        </div>
      </Card>

      <Card className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        {copy.reviewOnly}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <Card className="rounded-lg px-4 py-4">
          <p className="text-xs uppercase tracking-normal text-slate-500">{copy.reason}</p>
          <p className="mt-2 text-base text-slate-950">{preview.reason}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric label={copy.transactions} value={preview.page.total} locale={locale} />
            <Metric label={copy.accounts} value={preview.affectedAccountIds.length} locale={locale} />
            <Metric label={copy.tickers} value={preview.affectedTickers.length} locale={locale} />
            <Metric label={copy.blockers} value={preview.blockers.length} locale={locale} />
          </div>
        </Card>

        <Card className="rounded-lg px-4 py-4">
          <p className="text-sm font-semibold text-slate-950">{copy.accountingImpact}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ImpactValue label={copy.quantity} value={formatDelta(locale, preview.summary.quantityDelta, locale === "zh-TW" ? "股" : "shares")} tone={preview.summary.quantityDelta} />
            <ImpactValue label={copy.costBasis} value={formatDelta(locale, preview.summary.costBasisDelta)} tone={preview.summary.costBasisDelta} />
            <ImpactValue label={copy.realizedPnl} value={formatDelta(locale, preview.summary.realizedPnlDelta)} tone={preview.summary.realizedPnlDelta} />
            <ImpactValue label={copy.cash} value={formatDelta(locale, preview.summary.cashDelta)} tone={preview.summary.cashDelta} />
            <ImpactValue label={copy.dividends} value={`${formatNumber(preview.summary.reopenedDividendCount, locale)} ${copy.reopened}`} tone={preview.summary.reopenedDividendCount} />
          </div>
        </Card>
      </div>

      {(preview.warnings.length > 0 || preview.blockers.length > 0 || preview.page.items.some((item) => item.warnings.length > 0)) ? (
        <Card className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
            <div className="space-y-2 text-sm text-amber-900">
              {preview.blockers.slice(0, 4).map((blocker) => (
                <p key={blocker} className="font-semibold text-rose-800">{blocker}</p>
              ))}
              {(preview.warnings.length > 0 ? preview.warnings : preview.page.items.flatMap((item) => item.warnings)).slice(0, 4).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              {preview.page.items.some((item) => item.warnings.some((warning) => /manual|re-entry|reentry/i.test(warning))) ? (
                <p>{copy.manualReentry}</p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="rounded-lg px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative w-full lg:max-w-sm">
            <Filter className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              aria-label={copy.search}
              value={tickerQuery}
              onChange={(event) => setTickerQuery(event.target.value)}
              placeholder={copy.search}
              className="pl-9"
            />
          </div>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label={copy.allAccounts} className="w-full lg:w-[220px]">
              <SelectValue placeholder={copy.allAccounts} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allAccounts}</SelectItem>
              {accountOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label={copy.allChanges} className="w-full lg:w-[220px]">
              <SelectValue placeholder={copy.allChanges} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allChanges}</SelectItem>
              <SelectItem value="changed">{copy.changed}</SelectItem>
              <SelectItem value="deleted">{copy.deleted}</SelectItem>
              <SelectItem value="unchanged">{copy.unchanged}</SelectItem>
              <SelectItem value="warning">{copy.warnings}</SelectItem>
              <SelectItem value="blocked">{copy.blocked}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p> : null}
        {busy ? <p className="mt-3 text-sm text-slate-500">{copy.loading}</p> : null}

        {preview.page.items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">{copy.noItems}</p>
        ) : (
          <>
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-slate-200 lg:block">
            <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">{copy.transactions}</th>
                  <th className="px-3 py-2">{copy.before}</th>
                  <th className="px-3 py-2">{copy.after}</th>
                  <th className="px-3 py-2">{copy.impact}</th>
                  <th className="px-3 py-2">{copy.allChanges}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {preview.page.items.map((item) => (
                  <tr key={item.transactionId} className="align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-950">{item.transactionId}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {(item.before ?? item.after)?.accountName} · {(item.before ?? item.after)?.ticker}
                      </p>
                    </td>
                    <td className="px-3 py-3"><PreviewFactSummary locale={locale} item={item} state="before" /></td>
                    <td className="px-3 py-3"><PreviewFactSummary locale={locale} item={item} state="after" /></td>
                    <td className="px-3 py-3 text-xs">
                      <p>{copy.quantity}: {formatDelta(locale, item.impacts.quantityDelta)}</p>
                      <p>{copy.costBasis}: {formatDelta(locale, item.impacts.costBasisDelta)}</p>
                      <p>{copy.realizedPnl}: {formatDelta(locale, item.impacts.realizedPnlDelta)}</p>
                      <p>{copy.cash}: {formatDelta(locale, item.impacts.cashDelta)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                        item.status === "blocked"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : item.status === "deleted"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700",
                      )}>
                        {itemStatusLabel(locale, item.status)}
                      </span>
                      {[...item.blockers, ...item.warnings].map((message) => (
                        <p key={message} className="mt-2 max-w-64 text-xs text-amber-800">{message}</p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-4 lg:hidden">
            {preview.page.items.map((item) => (
              <article key={item.transactionId} className="rounded-lg border border-slate-200 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-950">{item.transactionId}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {(item.before ?? item.after)?.accountName} · {(item.before ?? item.after)?.ticker}
                    </p>
                  </div>
                  <span className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold",
                    item.status === "blocked"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : item.status === "deleted"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}>
                    {itemStatusLabel(locale, item.status)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <PreviewFactBlock locale={locale} label={copy.before} item={item} state="before" />
                  <PreviewFactBlock locale={locale} label={copy.after} item={item} state="after" />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <ImpactValue label={copy.quantity} value={formatDelta(locale, item.impacts.quantityDelta)} tone={item.impacts.quantityDelta} />
                  <ImpactValue label={copy.costBasis} value={formatDelta(locale, item.impacts.costBasisDelta)} tone={item.impacts.costBasisDelta} />
                  <ImpactValue label={copy.realizedPnl} value={formatDelta(locale, item.impacts.realizedPnlDelta)} tone={item.impacts.realizedPnlDelta} />
                  <ImpactValue label={copy.cash} value={formatDelta(locale, item.impacts.cashDelta)} tone={item.impacts.cashDelta} />
                </div>
                {(item.blockers.length > 0 || item.warnings.length > 0) ? (
                  <div className="mt-4 grid gap-2">
                    {item.blockers.map((blocker) => (
                      <p key={blocker} className="text-sm text-rose-700">{blocker}</p>
                    ))}
                    {item.warnings.map((warning) => (
                      <p key={warning} className="text-sm text-amber-700">{warning}</p>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {copy.showing
              .replace("{start}", String(startRow))
              .replace("{end}", String(endRow))
              .replace("{total}", String(preview.page.total))}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || preview.page.offset === 0}
              onClick={() => void load({ ...query, offset: Math.max(0, preview.page.offset - preview.page.limit) })}
            >
              {copy.previous}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || preview.page.offset + preview.page.limit >= preview.page.total}
              onClick={() => void load({ ...query, offset: preview.page.offset + preview.page.limit })}
            >
              {copy.next}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, locale, value }: { label: string; locale: LocaleCode; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="text-xs uppercase tracking-normal text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{formatNumber(value, locale)}</p>
    </div>
  );
}

function ImpactValue({ label, tone, value }: { label: string; tone: number; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="text-xs uppercase tracking-normal text-slate-500">{label}</p>
      <p className={cn(
        "mt-2 text-sm font-semibold",
        tone > 0 ? "text-emerald-700" : tone < 0 ? "text-rose-700" : "text-slate-900",
      )}>
        {value}
      </p>
    </div>
  );
}
