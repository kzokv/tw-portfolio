import { randomUUID } from "node:crypto";
import type { DividendSourceLine, MarketCode } from "@vakwen/shared-types";
import { roundToDecimal } from "@vakwen/domain";
import { routeError } from "../lib/routeError.js";
import type { McpToolHandlerContext } from "../mcp/types.js";
import type { DividendDeductionEntry, DividendLedgerEntry, Store } from "../types/store.js";
import type { DividendLedgerListOptions, DividendReviewRowWithDetails } from "../persistence/types.js";
import { buildConfirmationDigest } from "./mcpNameResolution.js";
import { buildDividendLedgerEntryDetails, postDividend } from "./dividends.js";

type ReconciliationStatus = DividendLedgerEntry["reconciliationStatus"];
type SourceCompositionStatus = DividendLedgerEntry["sourceCompositionStatus"];

interface TickerMarketInput {
  ticker: string;
  marketCode: MarketCode;
}

interface GetDividendReviewInput {
  fromPaymentDate?: string;
  toPaymentDate?: string;
  accountIds?: string[];
  accountNames?: string[];
  tickerMarkets?: TickerMarketInput[];
  postingStatus?: DividendLedgerEntry["postingStatus"];
  reconciliationStatus?: ReconciliationStatus;
  limit?: number;
  offset?: number;
}

interface DeductionInput {
  deductionType: DividendDeductionEntry["deductionType"];
  amount: number;
  currencyCode?: string;
  withheldAtSource?: boolean;
  source?: string;
  sourceReference?: string;
  note?: string;
}

interface SourceLineInput {
  id?: string;
  sourceBucket: DividendSourceLine["sourceBucket"];
  amount: number;
  currencyCode?: "TWD";
  source?: string;
  sourceReference?: string;
  note?: string;
}

interface DividendReceiptInput {
  rowId: string;
  receivedCashAmount?: number;
  receivedStockQuantity?: number;
  deductions?: DeductionInput[];
  sourceLines?: SourceLineInput[];
  sourceCompositionStatus?: SourceCompositionStatus;
}

interface ConfirmDividendReceiptInput extends DividendReceiptInput {
  confirmationSummary: string;
  confirmationDigest: string;
  idempotencyKey: string;
}

interface ReconciliationInput {
  rowId: string;
  status: ReconciliationStatus;
  note?: string;
}

interface ConfirmReconciliationInput extends ReconciliationInput {
  confirmationSummary: string;
  confirmationDigest: string;
}

interface ResolvedReviewRow {
  row: DividendReviewRowWithDetails;
  store: Store;
  userId: string;
}

type DividendReviewFetchOptions = Omit<DividendLedgerListOptions, "page" | "limit" | "sortBy" | "sortOrder">;

function contextUserId(deps: McpToolHandlerContext): string {
  return deps.requestContext.resolvedContext.portfolioContextUserId;
}

function accountNameById(store: Store): Map<string, string> {
  return new Map(store.accounts.map((account) => [account.id, account.name || account.id]));
}

function normalizeDeductions(input: DeductionInput[] = [], defaultCurrency = "TWD") {
  return input.map((entry) => ({
    deductionType: entry.deductionType,
    amount: entry.amount,
    currencyCode: entry.currencyCode ?? defaultCurrency,
    withheldAtSource: entry.withheldAtSource ?? true,
    source: entry.source ?? "mcp_dividend_posting",
    sourceReference: entry.sourceReference,
    note: entry.note,
  }));
}

function normalizeSourceLines(input: SourceLineInput[] = []) {
  return input.map((entry) => ({
    ...(entry.id ? { id: entry.id } : {}),
    sourceBucket: entry.sourceBucket,
    amount: entry.amount,
    currencyCode: entry.currencyCode ?? "TWD",
    source: entry.source ?? "mcp_dividend_posting",
    sourceReference: entry.sourceReference,
    note: entry.note,
  }));
}

function deductionTotal(deductions: ReadonlyArray<Pick<DividendDeductionEntry, "amount">>): number {
  return roundToDecimal(deductions.reduce((sum, deduction) => sum + deduction.amount, 0), 2);
}

function withheldDeductionTotal(deductions: ReadonlyArray<Pick<DividendDeductionEntry, "amount" | "withheldAtSource">>): number {
  return deductionTotal(deductions.filter((deduction) => deduction.withheldAtSource));
}

function actualCashEconomicAmount(
  receivedCashAmount: number,
  deductions: ReadonlyArray<Pick<DividendDeductionEntry, "amount" | "withheldAtSource">>,
): number {
  return roundToDecimal(receivedCashAmount + withheldDeductionTotal(deductions), 2);
}

function resolveSourceCompositionStatus(
  sourceLines: ReadonlyArray<SourceLineInput>,
  status?: SourceCompositionStatus,
): SourceCompositionStatus {
  return status ?? (sourceLines.length > 0 ? "provided" : "unknown_pending_disclosure");
}

function rowSummary(row: DividendReviewRowWithDetails, store: Store) {
  const names = accountNameById(store);
  const deductions = row.deductions ?? [];
  const deductionAmount = deductionTotal(deductions);
  const actualCash = actualCashEconomicAmount(row.receivedCashAmount, deductions);
  const displayName = row.tickerName ?? null;
  const deepLink = `/dividends?view=ledger&accountId=${encodeURIComponent(row.accountId)}&ticker=${encodeURIComponent(row.ticker)}&marketCode=${encodeURIComponent(row.marketCode)}${row.paymentDate ? `&fromPaymentDate=${row.paymentDate}&toPaymentDate=${row.paymentDate}` : ""}`;

  return {
    rowId: row.id,
    rowKind: row.rowKind,
    dividendEventId: row.dividendEventId,
    dividendLedgerEntryId: row.rowKind === "ledger" ? row.id : null,
    deepLink,
    accountId: row.accountId,
    accountName: names.get(row.accountId) ?? row.accountId,
    ticker: row.ticker,
    marketCode: row.marketCode,
    displayName,
    instrumentType: row.instrumentType,
    eventType: row.eventType,
    exDividendDate: row.exDividendDate,
    paymentDate: row.paymentDate,
    cashCurrency: row.cashCurrency,
    eligibleQuantity: row.eligibleQuantity,
    expectedCashAmount: row.expectedCashAmount,
    expectedStockQuantity: row.expectedStockQuantity,
    postingStatus: row.postingStatus,
    reconciliationStatus: row.reconciliationStatus,
    receivedCashAmount: row.receivedCashAmount,
    receivedStockQuantity: row.receivedStockQuantity,
    deductionTotal: deductionAmount,
    actualCashEconomicAmount: actualCash,
    cashVarianceAmount: roundToDecimal(row.expectedCashAmount - actualCash, 2),
    stockVarianceQuantity: row.expectedStockQuantity - row.receivedStockQuantity,
    sourceCompositionStatus: row.sourceCompositionStatus,
    canPostReceipt: row.postingStatus === "expected",
    canUpdateReconciliation: row.rowKind === "ledger" && row.postingStatus !== "expected",
    warnings: [
      ...(row.expectedStockQuantity > 0 ? ["Posting a stock or mixed dividend creates or updates an inventory lot."] : []),
      ...(row.rowKind === "expected" && row.paymentDate === null ? ["Payment date is not set on this dividend event."] : []),
    ],
  };
}

async function resolveRow(deps: McpToolHandlerContext, rowId: string): Promise<ResolvedReviewRow> {
  const userId = contextUserId(deps);
  const store = await deps.app.persistence.loadStore(userId);
  const rows = await fetchAllDividendReviewRows(deps, userId, { fromPaymentDate: "0001-01-01" });
  const row = rows.find((candidate) => candidate.id === rowId);
  if (!row) throw routeError(404, "mcp_dividend_review_row_not_found", "Dividend review row not found");
  return { row, store, userId };
}

function compareDividendReviewRows(left: DividendReviewRowWithDetails, right: DividendReviewRowWithDetails): number {
  if (left.paymentDate === null && right.paymentDate !== null) return 1;
  if (left.paymentDate !== null && right.paymentDate === null) return -1;
  if (left.paymentDate !== null && right.paymentDate !== null && left.paymentDate !== right.paymentDate) {
    return right.paymentDate.localeCompare(left.paymentDate);
  }
  return left.id.localeCompare(right.id);
}

async function fetchAllDividendReviewRows(
  deps: McpToolHandlerContext,
  userId: string,
  opts: DividendReviewFetchOptions,
): Promise<DividendReviewRowWithDetails[]> {
  const rows: DividendReviewRowWithDetails[] = [];
  const limit = 100;
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (rows.length < total) {
    const result = await deps.app.persistence.listDividendReviewRows(userId, {
      ...opts,
      page,
      limit,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });
    total = result.total;
    rows.push(...result.rows);
    if (result.rows.length === 0) break;
    page += 1;
  }

  return rows;
}

function receiptPreviewPayload(resolved: ResolvedReviewRow, input: DividendReceiptInput) {
  if (resolved.row.postingStatus !== "expected") {
    throw routeError(409, "mcp_dividend_receipt_requires_expected_row", "Posting over MCP requires an expected dividend review row.");
  }
  const deductions = normalizeDeductions(input.deductions, resolved.row.cashCurrency);
  const sourceLines = normalizeSourceLines(input.sourceLines);
  const receivedCashAmount = input.receivedCashAmount ?? resolved.row.expectedCashAmount;
  const receivedStockQuantity = input.receivedStockQuantity ?? resolved.row.expectedStockQuantity;
  const sourceCompositionStatus = resolveSourceCompositionStatus(sourceLines, input.sourceCompositionStatus);
  const summary = `Post dividend receipt for ${resolved.row.ticker} ${resolved.row.marketCode} in ${accountNameById(resolved.store).get(resolved.row.accountId) ?? resolved.row.accountId}: cash ${receivedCashAmount} ${resolved.row.cashCurrency}, stock ${receivedStockQuantity}.`;
  const digestPayload = {
    action: "post_dividend_receipt",
    ownerUserId: resolved.userId,
    rowId: resolved.row.id,
    dividendEventId: resolved.row.dividendEventId,
    accountId: resolved.row.accountId,
    receivedCashAmount,
    receivedStockQuantity,
    deductions,
    sourceLines,
    sourceCompositionStatus,
    rowFacts: rowSummary(resolved.row, resolved.store),
  };
  return {
    row: rowSummary(resolved.row, resolved.store),
    receipt: {
      receivedCashAmount,
      receivedStockQuantity,
      deductions,
      sourceLines,
      sourceCompositionStatus,
      deductionTotal: deductionTotal(deductions),
      actualCashEconomicAmount: actualCashEconomicAmount(receivedCashAmount, deductions),
      stockLotImpact: receivedStockQuantity > 0
        ? "Posting this receipt will create or update a stock-dividend inventory lot."
        : null,
    },
    confirmationSummary: summary,
    confirmationDigest: buildConfirmationDigest(digestPayload),
    requiresConfirmation: true,
    digestPayload,
  };
}

function assertConfirmation(input: { confirmationSummary?: string; confirmationDigest?: string }, summary: string, digestPayload: Record<string, unknown>) {
  const digest = buildConfirmationDigest(digestPayload);
  if (!input.confirmationSummary || !input.confirmationDigest) {
    throw routeError(409, "mcp_confirmation_required", "confirmationSummary and confirmationDigest are required.", {
      expectedSummary: summary,
      expectedDigest: digest,
    });
  }
  if (input.confirmationSummary !== summary || input.confirmationDigest !== digest) {
    throw routeError(409, "mcp_confirmation_stale", "The supplied confirmationSummary or confirmationDigest is stale. Re-run the preview tool.", {
      expectedSummary: summary,
      expectedDigest: digest,
    });
  }
}

function withoutDigestPayload<T extends { digestPayload: Record<string, unknown> }>(payload: T): Omit<T, "digestPayload"> {
  const { digestPayload, ...sanitized } = payload;
  void digestPayload;
  return sanitized;
}

function resolveAccountFilterIds(store: Store, userId: string, input: GetDividendReviewInput): Set<string> | null {
  const idsFromIds = input.accountIds && input.accountIds.length > 0 ? new Set(input.accountIds) : null;
  if (!input.accountNames || input.accountNames.length === 0) return idsFromIds;

  const accountsByName = new Map<string, Store["accounts"]>();
  for (const account of store.accounts.filter((candidate) => candidate.userId === userId)) {
    const key = account.name.trim().toLowerCase();
    const bucket = accountsByName.get(key) ?? [];
    bucket.push(account);
    accountsByName.set(key, bucket);
  }

  const idsFromNames = new Set<string>();
  for (const accountName of input.accountNames) {
    const matches = accountsByName.get(accountName.trim().toLowerCase()) ?? [];
    if (matches.length === 0) throw routeError(404, "mcp_account_not_found", `Active account named ${accountName} was not found`);
    if (matches.length > 1) throw routeError(409, "mcp_account_name_ambiguous", `Active account name ${accountName} matched multiple accounts`);
    idsFromNames.add(matches[0]!.id);
  }

  if (idsFromIds) {
    const idList = [...idsFromIds].sort();
    const nameList = [...idsFromNames].sort();
    if (idList.length !== nameList.length || idList.some((id, index) => id !== nameList[index])) {
      throw routeError(409, "mcp_account_filter_conflict", "accountIds and accountNames resolved to different accounts");
    }
  }

  return idsFromNames;
}

export async function getDividendReview(deps: McpToolHandlerContext, input: GetDividendReviewInput = {}) {
  const userId = contextUserId(deps);
  const store = await deps.app.persistence.loadStore(userId);
  const names = accountNameById(store);
  const accountIds = resolveAccountFilterIds(store, userId, input);
  const tickerMarkets = input.tickerMarkets ?? [];
  const pageSize = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const collected = new Map<string, DividendReviewRowWithDetails>();

  const filters = tickerMarkets.length > 0 ? tickerMarkets : [undefined];
  for (const tickerMarket of filters) {
    for (const accountId of accountIds && accountIds.size > 0 ? Array.from(accountIds) : [undefined]) {
      const rows = await fetchAllDividendReviewRows(deps, userId, {
        accountId,
        fromPaymentDate: input.fromPaymentDate,
        toPaymentDate: input.toPaymentDate,
        ticker: tickerMarket?.ticker,
        marketCode: tickerMarket?.marketCode,
        postingStatus: input.postingStatus,
        reconciliationStatus: input.reconciliationStatus,
      });
      for (const row of rows) collected.set(row.id, row);
    }
  }

  const sorted = Array.from(collected.values()).sort(compareDividendReviewRows);
  const rows = sorted.slice(offset, offset + pageSize).map((row) => rowSummary(row, store));
  return {
    rows,
    limit: pageSize,
    offset,
    hasMore: sorted.length > offset + pageSize,
    accountNamesById: Object.fromEntries([...names.entries()]),
  };
}

export async function previewPostDividendReceipt(deps: McpToolHandlerContext, input: DividendReceiptInput) {
  const resolved = await resolveRow(deps, input.rowId);
  return withoutDigestPayload(receiptPreviewPayload(resolved, input));
}

export async function postDividendReceipt(deps: McpToolHandlerContext, input: ConfirmDividendReceiptInput) {
  const userId = contextUserId(deps);
  const claimed = await deps.app.persistence.claimIdempotencyKey(userId, input.idempotencyKey);
  if (!claimed) throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");

  try {
    const resolved = await resolveRow(deps, input.rowId);
    const preview = receiptPreviewPayload(resolved, input);
    assertConfirmation(input, preview.confirmationSummary, preview.digestPayload);

    const draftStore = structuredClone(resolved.store);
    const result = postDividend(draftStore, resolved.userId, {
      id: randomUUID(),
      accountId: resolved.row.accountId,
      dividendEventId: resolved.row.dividendEventId,
      receivedCashAmount: preview.receipt.receivedCashAmount,
      receivedStockQuantity: preview.receipt.receivedStockQuantity,
      deductions: preview.receipt.deductions.map((entry) => ({ ...entry, id: randomUUID() })),
      sourceLines: preview.receipt.sourceLines.map((entry) => ({ ...entry, id: entry.id ?? randomUUID() })),
      sourceCompositionStatus: preview.receipt.sourceCompositionStatus,
    });
    await deps.app.persistence.savePostedDividend(
      resolved.userId,
      draftStore.accounting,
      draftStore.marketData,
      result.dividendLedgerEntry.id,
    );
    await deps.app.eventBus.publishEvent(resolved.userId, "dividend_posted", {
      dividendLedgerEntryId: result.dividendLedgerEntry.id,
      dividendEventId: result.dividendEvent.id,
      accountId: result.dividendLedgerEntry.accountId,
      version: result.dividendLedgerEntry.version,
    });
    const details = buildDividendLedgerEntryDetails(draftStore, [{
      ...result.dividendLedgerEntry,
      deductions: result.dividendDeductionEntries,
      sourceLines: result.dividendSourceLines,
    }])[0];
    return {
      posted: true,
      dividendLedgerEntryId: result.dividendLedgerEntry.id,
      ledgerEntry: details ?? result.dividendLedgerEntry,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    };
  } catch (error) {
    await deps.app.persistence.releaseIdempotencyKey(userId, input.idempotencyKey);
    throw error;
  }
}

function reconciliationPreviewPayload(resolved: ResolvedReviewRow, input: ReconciliationInput) {
  if (resolved.row.rowKind !== "ledger" || resolved.row.postingStatus === "expected") {
    throw routeError(409, "mcp_dividend_reconciliation_requires_ledger_row", "Reconciliation updates require a posted dividend ledger row.");
  }
  if (input.status === "explained" && !input.note?.trim()) {
    throw routeError(400, "mcp_dividend_reconciliation_note_required", "A note is required for explained reconciliation status.");
  }
  const summary = `Update dividend reconciliation for ${resolved.row.ticker} ${resolved.row.marketCode} to ${input.status}.`;
  const digestPayload = {
    action: "update_dividend_reconciliation",
    ownerUserId: resolved.userId,
    rowId: resolved.row.id,
    dividendLedgerEntryId: resolved.row.id,
    version: resolved.row.version,
    status: input.status,
    note: input.note?.trim() || null,
    rowFacts: rowSummary(resolved.row, resolved.store),
  };
  return {
    row: rowSummary(resolved.row, resolved.store),
    nextStatus: input.status,
    note: input.note?.trim() || null,
    confirmationSummary: summary,
    confirmationDigest: buildConfirmationDigest(digestPayload),
    requiresConfirmation: true,
    digestPayload,
  };
}

export async function previewUpdateDividendReconciliation(deps: McpToolHandlerContext, input: ReconciliationInput) {
  const resolved = await resolveRow(deps, input.rowId);
  return withoutDigestPayload(reconciliationPreviewPayload(resolved, input));
}

export async function updateDividendReconciliation(deps: McpToolHandlerContext, input: ConfirmReconciliationInput) {
  const resolved = await resolveRow(deps, input.rowId);
  const preview = reconciliationPreviewPayload(resolved, input);
  assertConfirmation(input, preview.confirmationSummary, preview.digestPayload);
  await deps.app.persistence.updateDividendReconciliationStatus(
    resolved.userId,
    resolved.row.id,
    input.status,
    input.note?.trim() || undefined,
    resolved.row.version,
  );
  const detailed = await deps.app.persistence.getDividendLedgerEntryWithDetails(resolved.userId, resolved.row.id);
  const latestStore = await deps.app.persistence.loadStore(resolved.userId);
  const ledgerEntry = detailed ? buildDividendLedgerEntryDetails(latestStore, [detailed])[0] : null;
  if (ledgerEntry) {
    await deps.app.eventBus.publishEvent(resolved.userId, "dividend_reconciliation_changed", {
      dividendLedgerEntryId: ledgerEntry.id,
      dividendEventId: ledgerEntry.dividendEventId,
      accountId: ledgerEntry.accountId,
      reconciliationStatus: ledgerEntry.reconciliationStatus,
      version: ledgerEntry.version,
    });
  }
  return {
    updated: true,
    dividendLedgerEntryId: resolved.row.id,
    ledgerEntry,
    confirmationSummary: preview.confirmationSummary,
    confirmationDigest: preview.confirmationDigest,
  };
}
