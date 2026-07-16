"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import type {
  ChatGptTransactionDraftWidgetDto,
  LocaleCode,
  TransactionDraftPostingResultDto,
  TransactionDraftRowDto,
} from "@vakwen/shared-types";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../ui/Tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/shadcn/table";
import {
  extractToolPayload,
  getOpenAiBridge,
  persistWidgetViewState,
  readWidgetPayloadFromBridge,
  readWidgetViewStateFromBridge,
} from "./openaiBridge";
import { accountDisplayName } from "./accountDisplay";
import { readAccountOptions, readPostingPreview, type ChatGptPostingPreviewSection } from "./chatGptWidgetTypes";
import { chatGptTransactionDraftCopy, normalizeChatGptLocale } from "./i18n";

interface ChatGptTransactionDraftWidgetProps {
  fallbackData?: ChatGptTransactionDraftWidgetDto | null;
  locale?: LocaleCode | string;
}

type EditableField = "accountName" | "marketCode" | "quantity" | "unitPrice" | "commissionAmount" | "taxAmount" | "note" | "sourceSnippet";
type EditDraftPatch = Partial<Record<EditableField, number | string>>;

interface EditDraft {
  accountName: string;
  commissionAmount: string;
  marketCode: string;
  note: string;
  quantity: string;
  sourceSnippet: string;
  taxAmount: string;
  unitPrice: string;
}

const EMPTY_EDIT_DRAFT: EditDraft = {
  accountName: "",
  commissionAmount: "",
  marketCode: "",
  note: "",
  quantity: "",
  sourceSnippet: "",
  taxAmount: "",
  unitPrice: "",
};

function toEditDraft(row: TransactionDraftRowDto): EditDraft {
  return {
    accountName: row.accountName ?? row.accountNameInput ?? "",
    commissionAmount: row.commissionAmount === null ? "" : String(row.commissionAmount),
    marketCode: row.marketCode ?? "",
    note: row.note ?? "",
    quantity: row.quantity === null ? "" : String(row.quantity),
    sourceSnippet: row.sourceSnippet ?? "",
    taxAmount: row.taxAmount === null ? "" : String(row.taxAmount),
    unitPrice: row.unitPrice === null ? "" : String(row.unitPrice),
  };
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildEditDraftPatch(draft: EditDraft): EditDraftPatch {
  const patch: EditDraftPatch = {};
  const addText = (field: EditableField, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed) patch[field] = trimmed;
  };
  const addNumber = (field: EditableField, raw: string) => {
    const parsed = parseOptionalNumber(raw);
    if (parsed !== undefined) patch[field] = parsed;
  };

  addText("accountName", draft.accountName);
  addNumber("commissionAmount", draft.commissionAmount);
  addText("marketCode", draft.marketCode);
  addText("note", draft.note);
  addText("sourceSnippet", draft.sourceSnippet);
  addNumber("taxAmount", draft.taxAmount);
  addNumber("quantity", draft.quantity);
  addNumber("unitPrice", draft.unitPrice);

  return patch;
}

function stateClassName(state: NonNullable<TransactionDraftRowDto["displayState"]>): string {
  if (state === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "confirmed") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (state === "posted_transaction_deleted") return "border-slate-300 bg-slate-100 text-slate-700";
  if (state === "excluded" || state === "rejected") return "border-slate-200 bg-slate-100 text-slate-600";
  if (state === "unsupported" || state === "needs_clarification") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function compactState(value: string, locale: LocaleCode): string {
  return chatGptTransactionDraftCopy[locale].rowStateLabels[value] ?? value.replace(/_/g, " ");
}

function rowGross(row: TransactionDraftRowDto): number {
  return (row.quantity ?? 0) * (row.unitPrice ?? 0);
}

function twdGross(rows: TransactionDraftRowDto[]): number {
  return rows
    .filter((row) => row.priceCurrency === "TWD")
    .reduce((sum, row) => sum + rowGross(row), 0);
}

function buildIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vakwen-post-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function issueText(value: unknown): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function rowAccountName(row: TransactionDraftRowDto): string {
  return accountDisplayName({
    accountName: (row as TransactionDraftRowDto & { accountName?: string | null }).accountName ?? row.accountNameInput,
    accountId: row.accountId,
  });
}

function rowFeeSourceLabel(row: TransactionDraftRowDto, locale: LocaleCode): string {
  const copy = chatGptTransactionDraftCopy[locale];
  if (row.feesSource === "MANUAL") return copy.manualFeeSource;
  if (row.feesSource === "SOURCE_PROVIDED") return copy.sourceProvidedFeeSource;
  if (row.feesSource === "CALCULATED") return copy.calculatedFeeSource;
  return copy.feeSourceFallback;
}

function buildFallbackPostingPreview(rows: TransactionDraftRowDto[], locale: LocaleCode): ChatGptPostingPreviewSection {
  const copy = chatGptTransactionDraftCopy[locale];
  const previewRows = rows.map((row) => {
    const gross = (row.quantity ?? 0) * (row.unitPrice ?? 0);
    const commission = row.commissionAmount ?? 0;
    const tax = row.taxAmount ?? 0;
    const direction = row.type === "SELL" ? 1 : -1;
    return {
      rowId: row.id,
      accountId: row.accountId,
      accountName: rowAccountName(row),
      ticker: row.ticker ?? "-",
      side: row.type ?? "-",
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
      commissionAmount: row.commissionAmount,
      taxAmount: row.taxAmount,
      feeSourceLabel: rowFeeSourceLabel(row, locale),
      netCashImpactAmount: direction * gross - commission - tax,
      netCashImpactCurrency: row.priceCurrency,
      warnings: [
        ...row.warnings.map(issueText),
        ...(row.feesSource === "MANUAL" && row.commissionAmount === 0 ? [copy.manualZeroCommissionWarning] : []),
      ],
    };
  });
  return {
    title: copy.draftPostingPreview,
    rows: previewRows,
    summaryRows: buildPostingPreviewSummaryRows(previewRows),
    warnings: [],
  };
}

function buildPostingPreviewSummaryRows(
  rows: ChatGptPostingPreviewSection["rows"],
): ChatGptPostingPreviewSection["summaryRows"] {
  const summaryMap = new Map<string, ChatGptPostingPreviewSection["summaryRows"][number]>();
  for (const row of rows) {
    const currency = row.priceCurrency ?? row.netCashImpactCurrency ?? "UNK";
    const key = `${row.accountId ?? "unknown"}:${currency}`;
    const current = summaryMap.get(key) ?? {
      accountId: row.accountId ?? null,
      accountName: row.accountName ?? null,
      currency,
      totalBuysAmount: 0,
      totalSellsAmount: 0,
      totalCommissionAmount: 0,
      totalTaxAmount: 0,
      netCashImpactAmount: 0,
    };
    const gross = (row.quantity ?? 0) * (row.unitPrice ?? 0);
    if (row.side === "SELL") current.totalSellsAmount = (current.totalSellsAmount ?? 0) + gross;
    else if (row.side === "BUY") current.totalBuysAmount = (current.totalBuysAmount ?? 0) + gross;
    current.totalCommissionAmount = (current.totalCommissionAmount ?? 0) + (row.commissionAmount ?? 0);
    current.totalTaxAmount = (current.totalTaxAmount ?? 0) + (row.taxAmount ?? 0);
    current.netCashImpactAmount = (current.netCashImpactAmount ?? 0) + (row.netCashImpactAmount ?? 0);
    summaryMap.set(key, current);
  }
  return [...summaryMap.values()];
}

function buildPostingPreviewForRows(
  data: ChatGptTransactionDraftWidgetDto | null,
  rows: TransactionDraftRowDto[],
  locale: LocaleCode,
): ChatGptPostingPreviewSection {
  const serverPreview = readPostingPreview(data);
  const copy = chatGptTransactionDraftCopy[locale];
  if (!serverPreview) return buildFallbackPostingPreview(rows, locale);

  const fallbackRowsById = new Map(buildFallbackPostingPreview(rows, locale).rows.map((row) => [row.rowId, row]));
  const serverRowsById = new Map(serverPreview.rows.map((row) => [row.rowId, row]));
  const previewRows = rows.flatMap((row) => serverRowsById.get(row.id) ?? fallbackRowsById.get(row.id) ?? []);

  return {
    title: serverPreview.title ?? copy.draftPostingPreview,
    rows: previewRows,
    summaryRows: buildPostingPreviewSummaryRows(previewRows),
    warnings: serverPreview.warnings,
  };
}

function previewAccountLabel(
  row: Pick<ChatGptPostingPreviewSection["rows"][number], "accountId" | "accountName">,
  accountNameById: Map<string, string>,
  locale: LocaleCode,
): string {
  const accountName = row.accountName?.trim();
  if (accountName) return accountName;
  const mappedName = row.accountId ? accountNameById.get(row.accountId) : null;
  return mappedName?.trim() || chatGptTransactionDraftCopy[locale].unassigned;
}

export function ChatGptTransactionDraftWidget({
  fallbackData = null,
  locale = "en",
}: ChatGptTransactionDraftWidgetProps) {
  const resolvedLocale = normalizeChatGptLocale(locale);
  const copy = chatGptTransactionDraftCopy[resolvedLocale];
  const bridge = getOpenAiBridge();
  const bridgedData = readWidgetPayloadFromBridge();
  const bridgedViewState = readWidgetViewStateFromBridge();
  const [data, setData] = useState<ChatGptTransactionDraftWidgetDto | null>(bridgedData ?? fallbackData);
  const [mode, setMode] = useState<"import" | "review" | "post">(bridgedViewState?.mode ?? bridgedData?.mode ?? fallbackData?.mode ?? "review");
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    new Set(bridgedViewState?.selectedRowIds ?? bridgedData?.selectedRowIds ?? fallbackData?.selectedRowIds ?? []),
  );
  const [editRowId, setEditRowId] = useState<string | null>(bridgedViewState?.editRowId ?? null);
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_EDIT_DRAFT);
  const [confirmText, setConfirmText] = useState(bridgedViewState?.confirmText ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [postingResult, setPostingResult] = useState<TransactionDraftPostingResultDto | null>(
    bridgedData?.postingResult ?? fallbackData?.postingResult ?? null,
  );

  useEffect(() => {
    if (!data && (bridgedData ?? fallbackData)) {
      setData(bridgedData ?? fallbackData);
    }
  }, [bridgedData, fallbackData, data]);

  useEffect(() => {
    persistWidgetViewState({
      confirmText,
      editRowId,
      mode,
      selectedRowIds: [...selectedRowIds],
    });
    bridge?.notifyIntrinsicHeight?.();
  }, [bridge, confirmText, editRowId, mode, selectedRowIds]);

  useEffect(() => {
    if (!data?.deepLinkUrl) return;
    bridge?.setOpenInAppUrl?.({ href: data.deepLinkUrl });
  }, [bridge, data?.deepLinkUrl]);

  const selectedRows = useMemo(
    () => data?.rows.filter((row) => selectedRowIds.has(row.id)) ?? [],
    [data?.rows, selectedRowIds],
  );
  const readySelectedRows = useMemo(
    () => selectedRows.filter((row) => row.state === "ready"),
    [selectedRows],
  );
  const accountOptions = useMemo(() => readAccountOptions(data), [data]);
  const accountSelectOptions = useMemo(() => {
    if (!editDraft.accountName || accountOptions.some((account) => account.name === editDraft.accountName)) {
      return accountOptions;
    }
    return [
      ...accountOptions,
      {
        id: `unresolved-${editDraft.accountName}`,
        name: editDraft.accountName,
      },
    ];
  }, [accountOptions, editDraft.accountName]);
  const accountNameById = useMemo(
    () => new Map(accountOptions.map((account) => [account.id, account.name])),
    [accountOptions],
  );
  const postingPreview = useMemo(
    () => buildPostingPreviewForRows(data, readySelectedRows, resolvedLocale),
    [data, readySelectedRows, resolvedLocale],
  );
  const needsReviewCount = data?.rows.filter((row) => row.state !== "ready" && row.state !== "confirmed").length ?? 0;
  const readySelectedTwdGross = twdGross(readySelectedRows);
  const typedPhrase = postingResult?.typedConfirmationPhrase
    ?? (data?.postingResult?.typedConfirmationPhrase)
    ?? `POST ${readySelectedRows.length} TRADES`;
  const requiresTypedConfirmation = postingResult?.requiresTypedConfirmation
    ?? data?.postingResult?.requiresTypedConfirmation
    ?? (
      data?.permissions.writeScopeGranted
      && (readySelectedRows.length >= 6 || readySelectedTwdGross >= 1_000_000)
    );
  const postingNeedsConfirmation = postingResult?.requiresTypedConfirmation && postingResult.postedRowIds.length === 0;
  const confirmedRowCount = data?.rows.filter((row) => row.state === "confirmed").length ?? 0;
  const activeEditRow = data?.rows.find((row) => row.id === editRowId) ?? null;
  const activeIssues = activeEditRow
    ? [...activeEditRow.preflightIssues, ...activeEditRow.warnings].map(issueText)
    : [];

  useEffect(() => {
    if (!activeEditRow) return;
    setEditDraft(toEditDraft(activeEditRow));
  }, [activeEditRow]);

  async function callTool(
    toolName: string | null,
    args: Record<string, unknown>,
    successMessage: string,
    options?: { keepMode?: boolean; onPostingResult?: boolean },
  ) {
    if (!bridge?.callTool || !toolName) return;
    setBusyAction(toolName);
    setError("");
    setMessage("");
    try {
      const result = await bridge.callTool(toolName, args);
      const payload = extractToolPayload(result);
      let nextMessage = successMessage;
      if (payload.widget) {
        setData(payload.widget);
        if (!options?.keepMode) setMode(payload.widget.mode);
      }
      if (payload.postingResult) {
        setPostingResult(payload.postingResult);
        if (options?.onPostingResult && payload.postingResult.requiresTypedConfirmation) {
          setMode("post");
          nextMessage = copy.typedConfirmationRequired;
        }
      }
      if (options?.onPostingResult && data?.tools.refresh) {
        const refreshed = await bridge.callTool(data.tools.refresh, { batchId: data.batch.id });
        const refreshPayload = extractToolPayload(refreshed);
        if (refreshPayload.widget) {
          setData(refreshPayload.widget);
        }
      }
      setMessage(nextMessage);
    } catch (toolError) {
      setError(toolError instanceof Error ? toolError.message : copy.widgetActionFailed);
    } finally {
      setBusyAction(null);
    }
  }

  function toggleRow(rowId: string, checked: boolean) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function openInVakwen() {
    if (!data?.deepLinkUrl) return;
    if (bridge?.openExternal) {
      void bridge.openExternal({ href: data.deepLinkUrl });
      return;
    }
    window.open(data.deepLinkUrl, "_blank", "noopener,noreferrer");
  }

  async function saveEdit() {
    if (!data || !activeEditRow) return;
    await callTool(
      data.tools.updateRow,
      {
        batchId: data.batch.id,
        rows: [{
          rowId: activeEditRow.id,
          expectedVersion: activeEditRow.version,
          patch: buildEditDraftPatch(editDraft),
        }],
      },
      copy.rowSaved,
      { keepMode: true },
    );
  }

  async function postSelectedRows() {
    if (!data) return;
    await callTool(
      data.tools.postRows,
      {
        batchId: data.batch.id,
        rowIds: readySelectedRows.map((row) => row.id),
        expectedBatchVersion: data.batch.version,
        expectedRowVersions: readySelectedRows.map((row) => ({ rowId: row.id, expectedVersion: row.version })),
        typedConfirmation: requiresTypedConfirmation ? confirmText : undefined,
        idempotencyKey: buildIdempotencyKey(),
      },
      copy.rowsPosted,
      { keepMode: true, onPostingResult: true },
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-50 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="border-slate-800 bg-slate-900/95 text-slate-50">
            <div className="flex items-start gap-3">
              <WandSparkles className="mt-0.5 h-5 w-5 text-sky-300" aria-hidden="true" />
              <div>
                <h1 className="text-lg font-semibold text-white">{copy.shellTitle}</h1>
                <p className="mt-1 text-sm text-slate-300">
                  {copy.waitingForBridge}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_28%),linear-gradient(180deg,#0f172a_0%,#111827_42%,#f8fafc_42%,#f8fafc_100%)] px-4 py-5 text-slate-950 sm:px-6"
      data-testid="chatgpt-transaction-draft-widget"
    >
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-[28px] border border-white/10 bg-slate-950/90 px-5 py-5 text-white shadow-2xl shadow-slate-950/35 backdrop-blur sm:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.bridgeOnly}
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{data.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300 sm:text-base">{data.subtitle}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  {copy.noRawFile}
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                  {formatNumber(data.rows.length, resolvedLocale)} {copy.rows}
                </span>
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                  {formatNumber(needsReviewCount, resolvedLocale)} {copy.needsReview}
                </span>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    data.permissions.writeScopeGranted
                      ? "border border-violet-400/30 bg-violet-400/10 text-violet-200"
                      : "border border-slate-700 bg-slate-800 text-slate-300",
                  )}
                >
                  {data.permissions.writeScopeGranted ? copy.writeEnabled : copy.writeNotGranted}
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{copy.bridgeNote}</p>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                {copy.bridgeDescription}
              </p>
              {data.permissions.requiresWriteReconsent ? (
                <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  {copy.requiresWriteReconsent}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.10)]">
          <header className="border-b border-slate-200 bg-slate-50/85 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{copy.shellTitle}</h2>
                  <p className="text-sm text-slate-600">{copy.shellDescription}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void callTool(data.tools.refresh, { batchId: data.batch.id }, copy.draftRefreshed, { keepMode: true })}
                  disabled={busyAction !== null || !data.tools.refresh}
                >
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  {copy.refresh}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openInVakwen}
                  disabled={!data.deepLinkUrl}
                  data-testid="chatgpt-widget-open-vakwen"
                >
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  {copy.openInVakwen}
                </Button>
              </div>
            </div>
          </header>

          <TabsRoot value={mode} onValueChange={(value) => setMode(value === "import" || value === "post" ? value : "review")}>
            <TabsList className="mx-5 mt-4 sm:mx-6" data-testid="chatgpt-widget-tabs">
              <TabsTrigger value="import">{copy.tabImport}</TabsTrigger>
              <TabsTrigger value="review">{copy.tabReview}</TabsTrigger>
              <TabsTrigger value="post">{copy.tabPost}</TabsTrigger>
            </TabsList>

            <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="p-5 sm:p-6">
                <TabsContent value="import" className="mt-0 space-y-5">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.source}</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">
                          {data.provenance.sourceLabel ?? data.provenance.sourceFilename ?? copy.temporaryChatGptImport}
                        </h3>
                        <p className="mt-2 max-w-3xl text-sm text-slate-600">{data.provenance.sourceSummary}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {copy.preflightComplete}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                          {copy.batch} v{data.batch.version}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: copy.rowsMetricLabel, value: formatNumber(data.rows.length, resolvedLocale), detail: copy.selectedCount(formatNumber(selectedRowIds.size, resolvedLocale)) },
                      { label: copy.readyMetricLabel, value: formatNumber(data.rows.filter((row) => row.state === "ready").length, resolvedLocale), detail: data.permissions.canPost ? copy.readyEligible : copy.readyReviewOnly },
                      { label: copy.needsReviewMetricLabel, value: formatNumber(needsReviewCount, resolvedLocale), detail: copy.needsReviewDetail },
                      { label: copy.grossValueMetricLabel, value: data.grossValueText, detail: requiresTypedConfirmation ? copy.typedConfirmationRequiredDetail : copy.buttonConfirmationDetail },
                    ].map((item) => (
                      <Card key={item.label} className="rounded-3xl border-slate-200 px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>
                        <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
                      </Card>
                    ))}
                  </div>

                  <Card className="rounded-3xl border-slate-200 px-5 py-5">
                    <h3 className="text-base font-semibold text-slate-950">{copy.connectorProvenance}</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.channel}</p>
                        <p className="mt-1 text-sm text-slate-700">{data.provenance.sourceChannelLabel}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.rowMappings}</p>
                        <p className="mt-1 text-sm text-slate-700">{data.provenance.rowMappingCount ?? copy.notProvided}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.structuredPayload}</p>
                        <p className="mt-1 text-sm text-slate-700">
                          {data.provenance.structuredCandidatesOnly
                            ? copy.structuredCandidatesOnly
                            : copy.additionalComponentMetadata}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.snippetCap}</p>
                        <p className="mt-1 text-sm text-slate-700">{copy.snippetCapValue(data.provenance.snippetCharacterCap)}</p>
                      </div>
                    </div>
                  </Card>

                  {data.unsupportedItems.length > 0 ? (
                    <Card className="rounded-3xl border-amber-200 bg-amber-50 px-5 py-5">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" aria-hidden="true" />
                        <div>
                          <h3 className="text-base font-semibold text-amber-900">{copy.unsupportedRowsTitle}</h3>
                          <p className="mt-1 text-sm text-amber-800">
                            {copy.unsupportedRowsDescription}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ) : null}
                </TabsContent>

                <TabsContent value="review" className="mt-0 space-y-5">
                  <Card className="rounded-3xl border-slate-200 px-0 py-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12" />
                            <TableHead>{copy.account}</TableHead>
                            <TableHead>{copy.ticker}</TableHead>
                            <TableHead>{copy.side}</TableHead>
                            <TableHead>{copy.quantity}</TableHead>
                            <TableHead>{copy.price}</TableHead>
                            <TableHead>{copy.fees}</TableHead>
                            <TableHead>{copy.date}</TableHead>
                            <TableHead>{copy.status}</TableHead>
                            <TableHead className="text-right">{copy.actions}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.rows.map((row) => {
                            const selectable = row.state !== "confirmed" && row.state !== "unsupported";
                            return (
                              <TableRow key={row.id} data-testid={`chatgpt-widget-row-${row.id}`}>
                                <TableCell>
                                  <input
                                    aria-label={copy.selectDraftRow(row.rowNumber)}
                                    checked={selectedRowIds.has(row.id)}
                                    disabled={!selectable}
                                    onChange={(event) => toggleRow(row.id, event.target.checked)}
                                    type="checkbox"
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="font-medium text-slate-900">{rowAccountName(row)}</div>
                                  <div className="text-xs text-slate-500">
                                    {row.accountNameInput && row.accountNameInput !== rowAccountName(row)
                                      ? `${copy.inputValuePrefix}: ${row.accountNameInput}`
                                      : row.accountId ? copy.matchedAccount : copy.unassigned}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="font-semibold text-slate-950">{row.ticker ?? "-"}</div>
                                  <div className="text-xs text-slate-500">{row.marketCode ?? "-"}</div>
                                </TableCell>
                                <TableCell>{row.type ?? "-"}</TableCell>
                                <TableCell>{row.quantity === null ? "-" : formatNumber(row.quantity, resolvedLocale)}</TableCell>
                                <TableCell>{row.priceCurrency ? formatCurrencyAmount(row.unitPrice ?? 0, row.priceCurrency, resolvedLocale) : "-"}</TableCell>
                                <TableCell>
                                  <div className="text-slate-900">
                                    {row.commissionAmount ?? 0} / {row.taxAmount ?? 0}
                                  </div>
                                  <div className="text-xs text-slate-500">{rowFeeSourceLabel(row, resolvedLocale)}</div>
                                </TableCell>
                                <TableCell>{row.tradeDate ?? "-"}</TableCell>
                                <TableCell>
                                  <span
                                    className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize", stateClassName(row.displayState ?? row.state))}
                                    data-testid={`chatgpt-widget-row-state-${row.id}`}
                                  >
                                    {compactState(row.displayState ?? row.state, resolvedLocale)}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditRowId(row.id)}
                                    disabled={!data.permissions.canEdit || row.state === "confirmed"}
                                    data-testid={`chatgpt-widget-edit-${row.id}`}
                                  >
                                    <Pencil className="h-4 w-4" aria-hidden="true" />
                                    <span className="sr-only">{copy.editRowSr}</span>
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>

                  <Card className="rounded-3xl border-slate-200 px-5 py-5">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void callTool(data.tools.excludeRows, { batchId: data.batch.id, rowIds: [...selectedRowIds], expectedBatchVersion: data.batch.version }, copy.rowsExcluded, { keepMode: true })}
                        disabled={busyAction !== null || selectedRowIds.size === 0}
                      >
                        <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                        {copy.exclude}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void callTool(data.tools.reincludeRows, { batchId: data.batch.id, rowIds: [...selectedRowIds], expectedBatchVersion: data.batch.version }, copy.rowsReincluded, { keepMode: true })}
                        disabled={busyAction !== null || selectedRowIds.size === 0}
                      >
                        {copy.reinclude}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void callTool(data.tools.rejectRows, { batchId: data.batch.id, rowIds: [...selectedRowIds], expectedBatchVersion: data.batch.version }, copy.rowsRejected, { keepMode: true })}
                        disabled={busyAction !== null || selectedRowIds.size === 0}
                      >
                        {copy.reject}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void callTool(data.tools.archiveBatch, { batchId: data.batch.id, expectedBatchVersion: data.batch.version }, copy.batchArchived, { keepMode: true })}
                        disabled={busyAction !== null || !data.permissions.canArchive}
                      >
                        <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                        {copy.archive}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void callTool(data.tools.deleteBatch, { batchId: data.batch.id, expectedBatchVersion: data.batch.version }, copy.batchDeleted, { keepMode: true })}
                        disabled={busyAction !== null || !data.permissions.canDelete}
                      >
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                        {copy.delete}
                      </Button>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="post" className="mt-0 space-y-5">
                  <Card className="rounded-3xl border-slate-200 px-5 py-5">
                    <h3 className="text-base font-semibold text-slate-950">{copy.postSelectedRows}</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      {copy.postDescription}
                    </p>

                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.selectedReadyRows}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{readySelectedRows.length}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.grossValueMetricLabel}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{postingPreview.rows.length > 0 ? data.grossValueText : "0"}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.confirmedRows}</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{confirmedRowCount}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{copy.postingScope}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-950">
                          {data.permissions.writeScopeGranted ? copy.granted : copy.notGranted}
                        </p>
                      </div>
                    </div>

                    {postingPreview.rows.length > 0 ? (
                      <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-base font-semibold text-slate-950">{postingPreview.title ?? copy.draftPostingPreview}</h4>
                            <p className="mt-1 text-sm text-slate-600">{copy.postingPreviewDescription}</p>
                          </div>
                        </div>
                        <div className="mt-4 overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{copy.account}</TableHead>
                                <TableHead>{copy.ticker}</TableHead>
                                <TableHead>{copy.side}</TableHead>
                                <TableHead>{copy.quantity}</TableHead>
                                <TableHead>{copy.price}</TableHead>
                                <TableHead>{copy.commission}</TableHead>
                                <TableHead>{copy.tax}</TableHead>
                                <TableHead>{copy.feeSource}</TableHead>
                                <TableHead className="text-right">{copy.netCashImpact}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {postingPreview.rows.map((row) => (
                                <TableRow key={row.rowId} data-testid={`chatgpt-widget-preview-row-${row.rowId}`}>
                                  <TableCell>
                                    <div className="font-medium text-slate-900">{previewAccountLabel(row, accountNameById, resolvedLocale)}</div>
                                    {row.warnings?.length ? <div className="mt-1 text-xs text-amber-700">{row.warnings[0]}</div> : null}
                                  </TableCell>
                                  <TableCell>{row.ticker}</TableCell>
                                  <TableCell>{row.side}</TableCell>
                                  <TableCell>{row.quantity ?? "-"}</TableCell>
                                  <TableCell>{row.priceCurrency ? formatCurrencyAmount(row.unitPrice ?? 0, row.priceCurrency, resolvedLocale) : "-"}</TableCell>
                                  <TableCell>{row.priceCurrency ? formatCurrencyAmount(row.commissionAmount ?? 0, row.priceCurrency, resolvedLocale) : row.commissionAmount ?? "-"}</TableCell>
                                  <TableCell>{row.priceCurrency ? formatCurrencyAmount(row.taxAmount ?? 0, row.priceCurrency, resolvedLocale) : row.taxAmount ?? "-"}</TableCell>
                                  <TableCell>{row.feeSourceLabel ?? copy.feeSourceFallback}</TableCell>
                                  <TableCell className="text-right">{row.netCashImpactCurrency ? formatCurrencyAmount(row.netCashImpactAmount ?? 0, row.netCashImpactCurrency, resolvedLocale) : "-"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        {postingPreview.summaryRows.length > 0 ? (
                          <div className="mt-4 overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{copy.account}</TableHead>
                                  <TableHead>{copy.currency}</TableHead>
                                  <TableHead>{copy.totalBuys}</TableHead>
                                  <TableHead>{copy.totalSells}</TableHead>
                                  <TableHead>{copy.totalCommission}</TableHead>
                                  <TableHead>{copy.totalTax}</TableHead>
                                  <TableHead className="text-right">{copy.netCashImpact}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {postingPreview.summaryRows.map((row, index) => (
                                  <TableRow key={`${row.accountId ?? "summary"}-${row.currency}-${index}`}>
                                    <TableCell>{previewAccountLabel(row, accountNameById, resolvedLocale)}</TableCell>
                                    <TableCell>{row.currency}</TableCell>
                                    <TableCell>{formatCurrencyAmount(row.totalBuysAmount ?? 0, row.currency, resolvedLocale)}</TableCell>
                                    <TableCell>{formatCurrencyAmount(row.totalSellsAmount ?? 0, row.currency, resolvedLocale)}</TableCell>
                                    <TableCell>{formatCurrencyAmount(row.totalCommissionAmount ?? 0, row.currency, resolvedLocale)}</TableCell>
                                    <TableCell>{formatCurrencyAmount(row.totalTaxAmount ?? 0, row.currency, resolvedLocale)}</TableCell>
                                    <TableCell className="text-right">{formatCurrencyAmount(row.netCashImpactAmount ?? 0, row.currency, resolvedLocale)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {data.permissions.requiresWriteReconsent ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                        {copy.requiresWriteReconsentDefault}
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-700" aria-hidden="true" />
                        <div className="space-y-3">
                          <div>
                            <p className="font-semibold text-amber-950">
                              {requiresTypedConfirmation ? copy.highValueConfirmation : copy.postingConfirmation}
                            </p>
                            <p className="mt-1 text-sm text-amber-800">
                              {requiresTypedConfirmation
                                ? copy.highValueConfirmationDescription
                                : copy.postingConfirmationDescription}
                            </p>
                          </div>
                          {requiresTypedConfirmation ? (
                            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-amber-900">
                              {copy.requiredPhrase}
                              <input
                                className="mt-2 block w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950"
                                onChange={(event) => setConfirmText(event.target.value)}
                                placeholder={typedPhrase}
                                value={confirmText}
                              />
                            </label>
                          ) : null}
                          <Button
                            onClick={() => void postSelectedRows()}
                            disabled={
                              busyAction !== null
                              || !data.permissions.canPost
                              || readySelectedRows.length === 0
                              || (requiresTypedConfirmation && confirmText !== typedPhrase)
                            }
                            data-testid="chatgpt-widget-post-button"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                            {copy.postSelected}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {postingResult ? (
                      <Card className={cn(
                        "mt-4 rounded-3xl px-5 py-5",
                        postingNeedsConfirmation
                          ? "border-amber-200 bg-amber-50"
                          : "border-emerald-200 bg-emerald-50",
                      )}>
                        <h4 className={cn(
                          "text-base font-semibold",
                          postingNeedsConfirmation ? "text-amber-950" : "text-emerald-950",
                        )}>
                          {postingNeedsConfirmation ? copy.confirmationRequired : copy.latestPostingResult}
                        </h4>
                        <p className={cn(
                          "mt-2 text-sm",
                          postingNeedsConfirmation ? "text-amber-800" : "text-emerald-800",
                        )}>
                          {postingNeedsConfirmation && postingResult.typedConfirmationPhrase
                            ? copy.typePhraseBeforePosting(postingResult.typedConfirmationPhrase)
                            : copy.postedRowsCreatedTransactions(postingResult.postedRowIds.length, postingResult.createdTransactionIds.length)}
                        </p>
                        <p className={cn(
                          "mt-2 text-sm",
                          postingNeedsConfirmation ? "text-amber-800" : "text-emerald-800",
                        )}>
                          {copy.remainingUnresolvedRows}: {postingResult.remainingUnresolvedRowIds.length}
                        </p>
                      </Card>
                    ) : null}
                  </Card>
                </TabsContent>
              </div>

              <aside className="border-t border-slate-200 bg-slate-50/80 p-5 xl:border-l xl:border-t-0 xl:p-6">
                <div className="space-y-5">
                  <Card className="rounded-3xl border-slate-200 px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-950">{copy.selectedRowEdit}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {copy.selectedRowEditDescription}
                        </p>
                      </div>
                      {activeEditRow ? (
                        <Button variant="ghost" size="sm" onClick={() => setEditRowId(null)}>
                          {copy.close}
                        </Button>
                      ) : null}
                    </div>

                    {activeEditRow ? (
                      <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {([
                            ["accountName", copy.editFieldLabels.accountName],
                            ["marketCode", copy.editFieldLabels.marketCode],
                            ["quantity", copy.editFieldLabels.quantity],
                            ["unitPrice", copy.editFieldLabels.unitPrice],
                            ["commissionAmount", copy.editFieldLabels.commissionAmount],
                            ["taxAmount", copy.editFieldLabels.taxAmount],
                          ] as Array<[EditableField, string]>).map(([field, label]) => (
                            <label key={field} className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {label}
                              {field === "accountName" && accountSelectOptions.length > 0 ? (
                                <select
                                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                                  onChange={(event) => setEditDraft((current) => ({ ...current, accountName: event.target.value }))}
                                  value={editDraft.accountName}
                                >
                                  <option value="">{copy.selectAccount}</option>
                                  {accountSelectOptions.map((account) => (
                                    <option key={account.id} value={account.name}>{account.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                                  onChange={(event) => setEditDraft((current) => ({ ...current, [field]: event.target.value }))}
                                  value={editDraft[field]}
                                />
                              )}
                            </label>
                          ))}
                          <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {copy.note}
                            <textarea
                              className="mt-2 block min-h-20 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                              onChange={(event) => setEditDraft((current) => ({ ...current, note: event.target.value }))}
                              value={editDraft.note}
                            />
                          </label>
                          <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {copy.sourceSnippet}
                            <textarea
                              className="mt-2 block min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
                              onChange={(event) => setEditDraft((current) => ({ ...current, sourceSnippet: event.target.value }))}
                              value={editDraft.sourceSnippet}
                            />
                          </label>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button onClick={() => void saveEdit()} disabled={busyAction !== null}>
                            {copy.saveRow}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">{copy.chooseRowToEdit}</p>
                    )}

                    {activeIssues.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                        <h4 className="text-sm font-semibold text-amber-950">{copy.validationDetails}</h4>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                          {activeIssues.map((item, index) => (
                            <li key={`${activeEditRow?.id ?? "row"}-issue-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {activeEditRow?.feesSource === "MANUAL" && (activeEditRow.commissionAmount === 0 || activeEditRow.taxAmount === 0) ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                        {copy.manualZeroFeeOverrideWarning}
                      </div>
                    ) : null}
                  </Card>

                  <Card className="rounded-3xl border-slate-200 px-5 py-5">
                    <h3 className="text-base font-semibold text-slate-950">{copy.auditPreview}</h3>
                    <div className="mt-4 space-y-3">
                      {data.auditPreview.map((item, index) => (
                        <div key={`${item.message}-${index}`} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 text-sm text-slate-700">
                          <span
                            className={cn(
                              "mt-1 h-3 w-3 rounded-full",
                              item.tone === "success" && "bg-emerald-500",
                              item.tone === "warning" && "bg-amber-500",
                              item.tone === "info" && "bg-sky-500",
                            )}
                          />
                          <span>{item.message}</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <button
                    type="button"
                    onClick={openInVakwen}
                    className="flex w-full items-center justify-between gap-3 rounded-3xl border border-sky-200 bg-sky-50 px-4 py-4 text-left text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                    disabled={!data.deepLinkUrl}
                  >
                    <span>{copy.reviewOrContinueInVakwen}</span>
                    <span className="truncate text-xs text-sky-600">{data.deepLinkUrl ?? "/transactions?tab=ai-inbox"}</span>
                  </button>
                </div>
              </aside>
            </div>
          </TabsRoot>
        </section>
      </div>
    </main>
  );
}
