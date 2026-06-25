"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, Pencil, RefreshCw, Trash2, XCircle } from "lucide-react";
import type { LocaleCode } from "@vakwen/shared-types";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import { readContextCookie, writeContextCookie } from "../../lib/context";
import { useEventStream } from "../../hooks/useEventStream";
import type { SharedContextPermissions } from "../../features/sharing/capabilities";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/shadcn/table";
import {
  archiveDraftBatch,
  confirmDraftRows,
  deleteDraftBatch,
  fetchAiInboxBadge,
  fetchDraftBatch,
  fetchDraftBatches,
  transitionDraftRows,
  updateDraftRow,
  type DraftBatchDetail,
  type DraftBatchSummary,
  type DraftRow,
  type DraftRowPatch,
} from "../../features/ai-inbox/service";
import { aiInboxCopy } from "./aiInboxI18n";

interface AiInboxPanelProps {
  initialBatchId?: string | null;
  initialContextId?: string | null;
  locale: LocaleCode;
  permissions?: SharedContextPermissions | null;
}

type EditDraft = Record<keyof DraftRowPatch, string>;

const EMPTY_EDIT_DRAFT: EditDraft = {
  accountId: "",
  accountName: "",
  type: "",
  ticker: "",
  marketCode: "",
  quantity: "",
  unitPrice: "",
  priceCurrency: "",
  tradeDate: "",
  tradeTimestamp: "",
  bookingSequence: "",
  isDayTrade: "",
  commissionAmount: "",
  taxAmount: "",
  note: "",
  sourceSnippet: "",
};

function stateClassName(state: DraftRow["state"]): string {
  if (state === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "confirmed") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (state === "excluded" || state === "rejected") return "border-slate-200 bg-slate-50 text-slate-600";
  if (state === "unsupported") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function compactState(state: string, locale: LocaleCode): string {
  if (locale === "zh-TW") {
    const labels: Record<string, string> = {
      ready: "可送出",
      confirmed: "已確認",
      excluded: "已排除",
      rejected: "已拒絕",
      unsupported: "不支援",
      needs_clarification: "需釐清",
    };
    return labels[state] ?? state.replace(/_/g, " ");
  }
  return state.replace(/_/g, " ");
}

function sourceChannelLabel(value: DraftBatchSummary["sourceChannel"], locale: LocaleCode): string {
  const copy = aiInboxCopy[locale];
  return value === "mcp" ? copy.sourceChannelMcp : copy.sourceChannelWeb;
}

function issueText(value: unknown): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function rowGross(row: DraftRow): number {
  return row.quantity && row.unitPrice ? row.quantity * row.unitPrice : 0;
}

function rowAccountLabel(row: DraftRow): string {
  return row.accountName?.trim() || row.accountNameInput?.trim() || row.accountId?.trim() || "-";
}

function toEditDraft(row: DraftRow): EditDraft {
  return {
    accountId: "",
    accountName: row.accountName ?? row.accountNameInput ?? "",
    type: row.type ?? "",
    ticker: row.ticker ?? "",
    marketCode: row.marketCode ?? "",
    quantity: row.quantity === null ? "" : String(row.quantity),
    unitPrice: row.unitPrice === null ? "" : String(row.unitPrice),
    priceCurrency: row.priceCurrency ?? "",
    tradeDate: row.tradeDate ?? "",
    tradeTimestamp: row.tradeTimestamp ?? "",
    bookingSequence: row.bookingSequence === null ? "" : String(row.bookingSequence),
    isDayTrade: row.isDayTrade === null ? "" : row.isDayTrade ? "true" : "false",
    commissionAmount: row.commissionAmount === null ? "" : String(row.commissionAmount),
    taxAmount: row.taxAmount === null ? "" : String(row.taxAmount),
    note: row.note ?? "",
    sourceSnippet: row.sourceSnippet ?? "",
  };
}

function parseEditDraft(value: EditDraft): DraftRowPatch {
  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const textOrNull = (raw: string): string | null => raw.trim() || null;
  return {
    accountId: textOrNull(value.accountId),
    accountName: textOrNull(value.accountName),
    type: value.type === "BUY" || value.type === "SELL" ? value.type : null,
    ticker: value.ticker.trim().toUpperCase() || null,
    marketCode: value.marketCode === "TW" || value.marketCode === "US" || value.marketCode === "AU" ? value.marketCode : null,
    quantity: numberOrNull(value.quantity),
    unitPrice: numberOrNull(value.unitPrice),
    priceCurrency: value.priceCurrency.trim().toUpperCase() || null,
    tradeDate: textOrNull(value.tradeDate),
    tradeTimestamp: textOrNull(value.tradeTimestamp),
    bookingSequence: numberOrNull(value.bookingSequence),
    isDayTrade: value.isDayTrade === "" ? null : value.isDayTrade === "true",
    commissionAmount: numberOrNull(value.commissionAmount),
    taxAmount: numberOrNull(value.taxAmount),
    note: textOrNull(value.note),
    sourceSnippet: textOrNull(value.sourceSnippet),
  };
}

export function AiInboxPanel({ initialBatchId, initialContextId, locale, permissions = null }: AiInboxPanelProps) {
  const copy = aiInboxCopy[locale];
  const [batches, setBatches] = useState<DraftBatchSummary[]>([]);
  const [detail, setDetail] = useState<DraftBatchDetail | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_EDIT_DRAFT);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [badge, setBadge] = useState({ openBatchCount: 0, actionRequiredRowCount: 0, readyRowCount: 0, latestBatchId: null as string | null });
  const currentBatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialContextId) return;
    if (readContextCookie() !== initialContextId) {
      writeContextCookie(initialContextId);
    }
  }, [initialContextId]);

  const load = useCallback(async (preferredBatchId?: string | null) => {
    setIsLoading(true);
    setError("");
    try {
      const [nextBadge, nextBatches] = await Promise.all([
        fetchAiInboxBadge(),
        fetchDraftBatches(),
      ]);
      setBadge(nextBadge);
      setBatches(nextBatches);
      const nextBatchId = preferredBatchId ?? currentBatchIdRef.current ?? nextBadge.latestBatchId ?? nextBatches[0]?.id ?? null;
      if (nextBatchId) {
        const nextDetail = await fetchDraftBatch(nextBatchId);
        currentBatchIdRef.current = nextDetail.batch.id;
        setDetail(nextDetail);
      } else {
        currentBatchIdRef.current = null;
        setDetail(null);
      }
      setSelectedRowIds(new Set());
      setEditRowId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load(initialBatchId ?? null);
  }, [initialBatchId, load]);

  useEventStream({
    eventTypes: ["ai_transaction_draft_created", "ai_transaction_draft_updated", "ai_transaction_draft_confirmed"],
    onEvent: () => {
      void load(currentBatchIdRef.current);
    },
    enabled: true,
  });

  const selectedRows = useMemo(() => {
    if (!detail) return [];
    return detail.rows.filter((row) => selectedRowIds.has(row.id));
  }, [detail, selectedRowIds]);
  const selectedReadyRows = selectedRows.filter((row) => row.state === "ready");
  const selectedGrossTwd = selectedReadyRows
    .filter((row) => row.priceCurrency === "TWD")
    .reduce((sum, row) => sum + rowGross(row), 0);
  const confirmedRowCount = detail?.rows.filter((row) => row.state === "confirmed").length ?? 0;
  const canEditDrafts = permissions?.canEditDrafts ?? true;
  const canArchiveDrafts = permissions?.canArchiveDrafts ?? true;
  const canDeleteDrafts = permissions?.canDeleteDrafts ?? true;
  const canPostDraftRows = permissions?.canWriteTransactions ?? true;
  const canSelectRows = canEditDrafts || canPostDraftRows;
  const typedPhrase = `POST ${selectedReadyRows.length} TRADES`;
  const requiresTypedConfirm = selectedReadyRows.length >= 6 || selectedGrossTwd >= 1_000_000;
  const activeEditRow = detail?.rows.find((row) => row.id === editRowId) ?? null;
  const activeEditIssues = activeEditRow
    ? [...activeEditRow.preflightIssues, ...activeEditRow.warnings].map(issueText)
    : [];

  async function mutate(action: () => Promise<DraftBatchDetail | { ok: true } | (DraftBatchDetail & { created: unknown[] })>, success: string) {
    setIsMutating(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if ("batch" in result) {
        currentBatchIdRef.current = result.batch.id;
        setDetail(result);
      } else {
        currentBatchIdRef.current = null;
        setDetail(null);
      }
      setSelectedRowIds(new Set());
      setEditRowId(null);
      setConfirmText("");
      setMessage(success);
      void load("batch" in result ? result.batch.id : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.actionError);
    } finally {
      setIsMutating(false);
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function startEdit(row: DraftRow) {
    setEditRowId(row.id);
    setEditDraft(toEditDraft(row));
  }

  function archiveCurrentBatch() {
    if (!detail) return;
    if (!window.confirm(copy.archiveConfirm)) return;
    void mutate(() => archiveDraftBatch(detail.batch.id, batchVersion), copy.batchArchived);
  }

  function deleteCurrentBatch() {
    if (!detail) return;
    if (!window.confirm(copy.deleteConfirm)) return;
    void mutate(() => deleteDraftBatch(detail.batch.id, batchVersion), copy.batchDeleted);
  }

  const batchVersion = detail?.batch.version ?? 0;

  return (
    <div className="grid gap-4" data-testid="ai-inbox-panel">
      <Card className="rounded-lg px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">{copy.title}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {formatNumber(badge.openBatchCount, locale)} {copy.openBatches} · {formatNumber(badge.readyRowCount, locale)} {copy.ready} · {formatNumber(badge.actionRequiredRowCount, locale)} {copy.needsReview}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(detail?.batch.id ?? null)} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.refresh}
          </Button>
        </div>
      </Card>

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-lg px-0 py-0">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">{copy.draftBatches}</h3>
          </div>
          <div className="max-h-[680px] overflow-auto p-2">
            {isLoading ? (
              <p className="px-2 py-6 text-sm text-slate-500">{copy.loadingBatches}</p>
            ) : batches.length === 0 ? (
              <p className="px-2 py-6 text-sm text-slate-500">{copy.noBatches}</p>
            ) : batches.map((batch) => {
              const active = detail?.batch.id === batch.id;
              return (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => void load(batch.id)}
                  className={cn(
                    "mb-2 w-full rounded-md border px-3 py-3 text-left text-sm transition",
                    active ? "border-indigo-200 bg-indigo-50" : "border-border bg-background hover:bg-accent/40",
                  )}
                >
                  <span className="block font-medium text-slate-900">{batch.sourceLabel ?? batch.sourceFilename ?? copy.draftBatchFallback}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {batch.rowCount} {locale === "zh-TW" ? "筆資料列" : "rows"} · {batch.unsupportedCount} {copy.unsupportedLabel} · v{batch.version}
                  </span>
                  <span className="mt-1 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {sourceChannelLabel(batch.sourceChannel, locale)}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{new Date(batch.updatedAt).toLocaleString(locale === "zh-TW" ? "zh-TW" : "en-US")}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="grid gap-4">
          {!detail ? (
            <Card className="rounded-lg">
              <p className="text-sm text-slate-500">{copy.selectBatch}</p>
            </Card>
          ) : (
            <>
              <Card className="rounded-lg">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">{detail.batch.sourceLabel ?? detail.batch.sourceFilename ?? copy.draftBatchFallback}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {detail.batch.rowCount} {locale === "zh-TW" ? "筆資料列" : "rows"} · {detail.batch.unsupportedCount} {copy.unsupportedLabel} · {copy.statusLabel} {detail.batch.status} · {copy.versionLabel} {detail.batch.version}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {sourceChannelLabel(detail.batch.sourceChannel, locale)}
                      </span>
                      {detail.batch.connectorConnectionId ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                          {copy.connectorLabel} {detail.batch.connectorConnectionId}
                        </span>
                      ) : null}
                      {confirmedRowCount > 0 ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {confirmedRowCount} {copy.rowsPosted}
                        </span>
                      ) : null}
                    </div>
                    {detail.batch.note ? <p className="mt-2 text-sm text-slate-600">{detail.batch.note}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || !canEditDrafts || selectedRows.length === 0}
                      onClick={() => void mutate(
                        () => transitionDraftRows("exclude", detail.batch.id, [...selectedRowIds], batchVersion),
                        copy.rowsExcluded,
                      )}
                    >
                      <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                      {copy.exclude}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || !canEditDrafts || selectedRows.length === 0}
                      onClick={() => void mutate(
                        () => transitionDraftRows("reinclude", detail.batch.id, [...selectedRowIds], batchVersion),
                        copy.rowsReincluded,
                      )}
                    >
                      {copy.reinclude}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || !canEditDrafts || selectedRows.length === 0}
                      onClick={() => void mutate(
                        () => transitionDraftRows("reject", detail.batch.id, [...selectedRowIds], batchVersion),
                        copy.rowsRejected,
                      )}
                    >
                      {copy.reject}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || !canArchiveDrafts}
                      onClick={archiveCurrentBatch}
                    >
                      <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                      {copy.archive}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isMutating || !canDeleteDrafts}
                      onClick={deleteCurrentBatch}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {copy.delete}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{copy.connectorProvenance}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {detail.batch.sourceChannel === "mcp"
                        ? copy.connectorProvenanceMcp
                        : copy.connectorProvenanceWeb}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {copy.sourceLabel}: {detail.batch.sourceLabel ?? detail.batch.sourceFilename ?? copy.sourceLabelFallback}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {copy.sourceSnippetsCapped}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <a
                      href={detail.deepLinkUrl}
                      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                    >
                      {copy.openDeepLink}
                    </a>
                    <span className="text-xs text-slate-500">
                      {copy.auditNote}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-md border border-border bg-slate-50 p-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {selectedReadyRows.length} {copy.readyRowsSelected}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {copy.twdGross} {formatCurrencyAmount(selectedGrossTwd, "TWD", locale)}
                    </p>
                  </div>
                  {requiresTypedConfirm ? (
                    <label className="text-xs text-slate-600">
                      {copy.typedConfirmation}
                      <input
                        value={confirmText}
                        onChange={(event) => setConfirmText(event.target.value)}
                        disabled={!canPostDraftRows}
                        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder={typedPhrase}
                      />
                    </label>
                  ) : null}
                  <Button
                    disabled={
                      isMutating
                      || !canPostDraftRows
                      || selectedReadyRows.length === 0
                      || (requiresTypedConfirm && confirmText !== typedPhrase)
                    }
                    onClick={() => void mutate(
                      () => confirmDraftRows(detail.batch.id, selectedReadyRows.map((row) => ({ id: row.id, version: row.version })), batchVersion, confirmText || undefined),
                      copy.rowsPostedMessage,
                    )}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {copy.postSelected}
                  </Button>
                </div>
              </Card>

              {detail.unsupportedItems.length > 0 ? (
                <Card className="rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">{copy.unsupportedRows}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {detail.unsupportedItems.length} {copy.unsupportedRowsDescription}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 divide-y divide-border rounded-md border border-border">
                    {detail.unsupportedItems.map((item) => (
                      <div key={item.id} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[80px_160px_minmax(0,1fr)]">
                        <span className="font-medium text-slate-900">{copy.rowLabel} {item.rowNumber}</span>
                        <span className="text-slate-600">{compactState(item.category, locale)}</span>
                        <span className="min-w-0 text-slate-600">
                          {item.reason}
                          {item.sourceSnippet ? (
                            <span className="mt-1 block truncate text-xs text-slate-500">{item.sourceSnippet}</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              <Card className="rounded-lg px-0 py-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12" />
                        <TableHead>{copy.rowLabel}</TableHead>
                        <TableHead>{copy.tableStatus}</TableHead>
                        <TableHead>{copy.tableTrade}</TableHead>
                        <TableHead>{copy.tableAccount}</TableHead>
                        <TableHead className="text-right">{copy.tableGross}</TableHead>
                        <TableHead>{copy.tableFees}</TableHead>
                        <TableHead>{copy.tableIssues}</TableHead>
                        <TableHead className="text-right">{copy.tableEdit}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.rows.map((row) => {
                        const selectable = canSelectRows && row.state !== "confirmed" && row.state !== "unsupported";
                        return (
                          <TableRow key={row.id}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedRowIds.has(row.id)}
                                disabled={!selectable}
                                onChange={(event) => toggleRow(row.id, event.target.checked)}
                                aria-label={`${copy.ariaSelectRow} ${row.rowNumber}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{row.rowNumber}</TableCell>
                            <TableCell>
                              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs capitalize", stateClassName(row.state))}>
                                {compactState(row.state, locale)}
                              </span>
                            </TableCell>
                            <TableCell className="min-w-[190px]">
                              <div className="font-medium text-slate-900">
                                {row.type ?? "-"} {row.quantity ?? "-"} {row.ticker ?? "-"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {row.tradeDate ?? "-"} · {row.marketCode ?? "-"} · {row.priceCurrency ?? "-"}
                              </div>
                            </TableCell>
                            <TableCell>{rowAccountLabel(row)}</TableCell>
                            <TableCell className="text-right">
                              {row.priceCurrency ? formatCurrencyAmount(rowGross(row), row.priceCurrency, locale) : "-"}
                            </TableCell>
                            <TableCell>
                              {row.commissionAmount ?? row.taxAmount
                                ? `${row.commissionAmount ?? 0} / ${row.taxAmount ?? 0}`
                                : row.feesSource === "CALCULATED" ? copy.calculatedFees : "-"}
                            </TableCell>
                            <TableCell className="max-w-[240px] text-xs text-slate-500">
                              {[...row.preflightIssues, ...row.warnings].slice(0, 2).map(issueText).join(" · ") || "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => startEdit(row)} disabled={!canEditDrafts || row.state === "confirmed"}>
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">{copy.editRow}</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {activeEditRow ? (
                <Card className="rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">{copy.rowLabel} {activeEditRow.rowNumber}</h3>
                      <p className="mt-1 text-sm text-slate-600">{copy.version} {activeEditRow.version}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setEditRowId(null)}>{copy.close}</Button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {([
                      ["accountName", copy.account],
                      ["type", copy.type],
                      ["ticker", copy.ticker],
                      ["marketCode", copy.market],
                      ["quantity", copy.quantity],
                      ["unitPrice", copy.unitPrice],
                      ["priceCurrency", copy.currency],
                      ["tradeDate", copy.tradeDate],
                      ["tradeTimestamp", copy.timestamp],
                      ["bookingSequence", copy.sequence],
                      ["commissionAmount", copy.commission],
                      ["taxAmount", copy.tax],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="text-xs font-medium text-slate-600">
                        {label}
                        <input
                          value={editDraft[key]}
                          onChange={(event) => setEditDraft((current) => ({ ...current, [key]: event.target.value }))}
                          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </label>
                    ))}
                    <label className="text-xs font-medium text-slate-600">
                      {copy.dayTrade}
                      <select
                        value={editDraft.isDayTrade}
                        onChange={(event) => setEditDraft((current) => ({ ...current, isDayTrade: event.target.value }))}
                        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">{locale === "zh-TW" ? "未設定" : "Unset"}</option>
                        <option value="false">{locale === "zh-TW" ? "否" : "No"}</option>
                        <option value="true">{locale === "zh-TW" ? "是" : "Yes"}</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600 md:col-span-3">
                      {copy.note}
                      <textarea
                        value={editDraft.note}
                        onChange={(event) => setEditDraft((current) => ({ ...current, note: event.target.value }))}
                        className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600 md:col-span-3">
                      {copy.sourceSnippet}
                      <textarea
                        value={editDraft.sourceSnippet}
                        onChange={(event) => setEditDraft((current) => ({ ...current, sourceSnippet: event.target.value }))}
                        className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      disabled={isMutating || !canEditDrafts}
                      onClick={() => void mutate(
                        () => updateDraftRow(detail.batch.id, activeEditRow.id, activeEditRow.version, parseEditDraft(editDraft)),
                        copy.rowSaved,
                      )}
                    >
                      {copy.saveRow}
                    </Button>
                  </div>
                  {activeEditIssues.length > 0 ? (
                    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                      <h4 className="text-sm font-semibold text-amber-900">{locale === "zh-TW" ? "驗證細節" : "Validation details"}</h4>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                        {activeEditIssues.map((item, index) => (
                          <li key={`${activeEditRow.id}-issue-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {activeEditRow.sourceSnippet ? (
                    <pre className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-slate-50 p-3 text-xs text-slate-600">
                      {activeEditRow.sourceSnippet}
                    </pre>
                  ) : null}
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
