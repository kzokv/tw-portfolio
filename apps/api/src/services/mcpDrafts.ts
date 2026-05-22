import { randomUUID } from "node:crypto";
import { currencyFor, marketCodeFor } from "@vakwen/shared-types";
import type { AiTransactionDraftEventType } from "@vakwen/shared-types";
import type {
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftRowRecord,
} from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import type { McpDraftServiceDeps, McpMutationBatchResult } from "../mcp/types.js";

type TradeType = "BUY" | "SELL";
type RowState = AiTransactionDraftRowRecord["state"];

export interface DraftCandidateInput {
  rowNumber: number;
  recordType: "trade" | "unsupported";
  accountId?: string;
  accountName?: string;
  type?: TradeType;
  ticker?: string;
  marketCode?: "TW" | "US" | "AU";
  quantity?: number;
  unitPrice?: number;
  priceCurrency?: string;
  tradeDate?: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  isDayTrade?: boolean;
  commissionAmount?: number;
  taxAmount?: number;
  note?: string;
  sourceRowRef?: string;
  sourceSnippet?: string;
  rawPayload?: Record<string, unknown>;
}

interface DraftBatchMetadataInput {
  sourceLabel?: string;
  sourceFilename?: string;
  note?: string;
  provenance?: Record<string, unknown>;
}

interface PreflightRowResult {
  rowNumber: number;
  state: RowState;
  blocking: boolean;
  normalized: {
    accountId: string | null;
    accountNameInput: string | null;
    tradeType: TradeType | null;
    ticker: string | null;
    marketCode: "TW" | "US" | "AU" | null;
    quantity: number | null;
    unitPrice: number | null;
    priceCurrency: string | null;
    tradeDate: string | null;
    tradeTimestamp: string | null;
    bookingSequence: number | null;
    isDayTrade: boolean | null;
    commissionAmount: number | null;
    taxAmount: number | null;
    note: string | null;
    sourceRowRef: string | null;
    sourceSnippet: string | null;
    normalizedPayload: Record<string, unknown>;
  };
  issues: Array<{ code: string; message: string }>;
  warnings: string[];
  unsupported?: {
    category: string;
    reason: string;
    sourceSnippet: string | null;
    rawPayload: Record<string, unknown>;
  };
}

interface PreflightResult {
  rows: PreflightRowResult[];
  blockingRowCount: number;
  unsupportedCount: number;
}

function buildDeepLink(appBaseUrl: string, batchId: string, contextUserId: string): string {
  return `${appBaseUrl}/transactions?tab=ai-inbox&batch=${encodeURIComponent(batchId)}&context=${encodeURIComponent(contextUserId)}`;
}

function ensureMetadataCaps(input: DraftBatchMetadataInput): void {
  if ((input.sourceLabel?.length ?? 0) > 200) throw routeError(400, "mcp_source_label_too_long", "sourceLabel exceeds 200 characters");
  if ((input.sourceFilename?.length ?? 0) > 200) throw routeError(400, "mcp_source_filename_too_long", "sourceFilename exceeds 200 characters");
  if ((input.note?.length ?? 0) > 1_000) throw routeError(400, "mcp_note_too_long", "note exceeds 1,000 characters");
}

async function loadDraftStore(deps: McpDraftServiceDeps) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const store = await deps.app.persistence.loadStore(contextUserId);
  return { store, contextUserId };
}

function cloneWarnings(warnings: string[]): string[] {
  return warnings.slice(0, 10);
}

function getCurrentQuantity(
  holdings: Array<{ accountId: string; ticker: string; quantity: number }>,
  accountId: string,
  ticker: string,
): number {
  return holdings.find((holding) => holding.accountId === accountId && holding.ticker === ticker)?.quantity ?? 0;
}

async function runPreflight(
  deps: McpDraftServiceDeps,
  candidates: DraftCandidateInput[],
): Promise<PreflightResult> {
  if (candidates.length === 0 || candidates.length > 200) {
    throw routeError(400, "mcp_invalid_candidate_count", "Draft candidate batches must contain 1 to 200 rows");
  }
  const { store } = await loadDraftStore(deps);
  const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
  const accountsByName = new Map<string, typeof store.accounts>();
  for (const account of store.accounts) {
    const key = account.name.trim().toLowerCase();
    const bucket = accountsByName.get(key) ?? [];
    bucket.push(account);
    accountsByName.set(key, bucket);
  }

  const baseRows: PreflightRowResult[] = [];
  for (const candidate of candidates.slice().sort((left, right) => left.rowNumber - right.rowNumber)) {
    if (candidate.recordType === "unsupported") {
      baseRows.push({
        rowNumber: candidate.rowNumber,
        state: "unsupported",
        blocking: false,
        normalized: {
          accountId: null,
          accountNameInput: candidate.accountName ?? null,
          tradeType: null,
          ticker: candidate.ticker?.trim().toUpperCase() ?? null,
          marketCode: candidate.marketCode ?? null,
          quantity: candidate.quantity ?? null,
          unitPrice: candidate.unitPrice ?? null,
          priceCurrency: candidate.priceCurrency?.trim().toUpperCase() ?? null,
          tradeDate: candidate.tradeDate ?? null,
          tradeTimestamp: candidate.tradeTimestamp ?? null,
          bookingSequence: candidate.bookingSequence ?? null,
          isDayTrade: candidate.isDayTrade ?? null,
          commissionAmount: candidate.commissionAmount ?? null,
          taxAmount: candidate.taxAmount ?? null,
          note: candidate.note ?? null,
          sourceRowRef: candidate.sourceRowRef ?? null,
          sourceSnippet: candidate.sourceSnippet ?? null,
          normalizedPayload: { ...(candidate.rawPayload ?? {}) },
        },
        issues: [],
        warnings: [],
        unsupported: {
          category: "non_trade",
          reason: "Only BUY and SELL trade rows are draftable in V1",
          sourceSnippet: candidate.sourceSnippet ?? null,
          rawPayload: { ...(candidate.rawPayload ?? {}) },
        },
      });
      continue;
    }

    const issues: Array<{ code: string; message: string }> = [];
    const warnings: string[] = [];
    let accountId = candidate.accountId?.trim() || null;
    const accountNameInput = candidate.accountName?.trim() || null;
    let marketCode = candidate.marketCode ?? null;
    let priceCurrency = candidate.priceCurrency?.trim().toUpperCase() ?? null;
    const ticker = candidate.ticker?.trim().toUpperCase() || null;
    const normalizedPayload = { ...(candidate.rawPayload ?? {}) };

    if (!accountId && accountNameInput) {
      const matches = accountsByName.get(accountNameInput.toLowerCase()) ?? [];
      if (matches.length === 1) {
        accountId = matches[0]!.id;
        warnings.push("account inferred from unique account name");
      } else if (matches.length > 1) {
        issues.push({ code: "ambiguous_account", message: "Account name matches multiple accounts" });
      }
    }

    const account = accountId ? accountsById.get(accountId) ?? null : null;
    if (!accountId) {
      issues.push({ code: "missing_account", message: "accountId or uniquely resolvable accountName is required" });
    } else if (!account) {
      issues.push({ code: "inactive_or_missing_account", message: "Account is missing, inactive, or unavailable" });
    }

    if (account) {
      const inferredMarket = marketCodeFor(account.defaultCurrency);
      const inferredCurrency = currencyFor(inferredMarket);
      if (!marketCode) {
        marketCode = inferredMarket;
        warnings.push("marketCode inferred from account");
      }
      if (!priceCurrency) {
        priceCurrency = inferredCurrency;
        warnings.push("priceCurrency inferred from account");
      }
    }

    if (!candidate.type) issues.push({ code: "missing_type", message: "type is required" });
    if (!ticker) issues.push({ code: "missing_ticker", message: "ticker is required" });
    if (!candidate.quantity) issues.push({ code: "missing_quantity", message: "quantity is required" });
    if (!candidate.unitPrice) issues.push({ code: "missing_unit_price", message: "unitPrice is required" });
    if (!candidate.tradeDate) issues.push({ code: "missing_trade_date", message: "tradeDate is required" });
    if (!marketCode) issues.push({ code: "missing_market_code", message: "marketCode is required" });
    if (!priceCurrency) issues.push({ code: "missing_price_currency", message: "priceCurrency is required" });

    if (candidate.sourceSnippet && candidate.sourceSnippet.length > 500) {
      issues.push({ code: "source_snippet_too_long", message: "sourceSnippet exceeds 500 characters" });
    }

    if (candidate.tradeTimestamp && !candidate.tradeDate) {
      issues.push({ code: "missing_trade_date", message: "tradeDate is required when tradeTimestamp is provided" });
    }

    const storeInstrument = ticker && marketCode
      ? store.instruments.find((instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode) ?? null
      : null;
    const catalogInstrument = !storeInstrument && ticker && marketCode
      ? await deps.app.persistence.getInstrument(ticker, marketCode)
      : null;
    const instrumentType = storeInstrument?.type ?? catalogInstrument?.instrumentType ?? null;
    if (ticker && marketCode && !storeInstrument && !catalogInstrument) {
      issues.push({ code: "unknown_instrument", message: "Instrument is unknown or not yet classified" });
    } else if (ticker && marketCode && instrumentType === null) {
      issues.push({ code: "unclassified_instrument", message: "Instrument is not classified for trading" });
    }

    baseRows.push({
      rowNumber: candidate.rowNumber,
      state: issues.length > 0 ? "invalid" : "ready",
      blocking: issues.length > 0,
      normalized: {
        accountId,
        accountNameInput,
        tradeType: candidate.type ?? null,
        ticker,
        marketCode,
        quantity: candidate.quantity ?? null,
        unitPrice: candidate.unitPrice ?? null,
        priceCurrency,
        tradeDate: candidate.tradeDate ?? null,
        tradeTimestamp: candidate.tradeTimestamp ?? null,
        bookingSequence: candidate.bookingSequence ?? null,
        isDayTrade: candidate.isDayTrade ?? false,
        commissionAmount: candidate.commissionAmount ?? null,
        taxAmount: candidate.taxAmount ?? null,
        note: candidate.note ?? null,
        sourceRowRef: candidate.sourceRowRef ?? null,
        sourceSnippet: candidate.sourceSnippet ?? null,
        normalizedPayload,
      },
      issues,
      warnings,
    });
  }

  const exactDuplicateKeys = new Set<string>();
  const existingSameDayKeys = new Set<string>();
  for (const trade of store.accounting.facts.tradeEvents) {
    exactDuplicateKeys.add([
      trade.accountId,
      trade.ticker,
      trade.marketCode,
      trade.type,
      trade.quantity,
      trade.unitPrice,
      trade.priceCurrency,
      trade.tradeDate,
      trade.tradeTimestamp ?? "",
      trade.bookingSequence ?? "",
    ].join("|"));
    existingSameDayKeys.add([
      trade.accountId,
      trade.ticker,
      trade.marketCode,
      trade.tradeDate,
    ].join("|"));
  }

  const pendingByDateKey = new Map<string, number>();
  const runningInventory = new Map<string, number>();
  for (const row of baseRows) {
    if (row.normalized.accountId && row.normalized.ticker) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      if (!runningInventory.has(inventoryKey)) {
        runningInventory.set(
          inventoryKey,
          getCurrentQuantity(store.accounting.projections.holdings, row.normalized.accountId, row.normalized.ticker),
        );
      }
    }

    if (row.state === "unsupported" || row.normalized.accountId === null || row.normalized.ticker === null || row.normalized.marketCode === null) {
      continue;
    }

    const duplicateKey = [
      row.normalized.accountId,
      row.normalized.ticker,
      row.normalized.marketCode,
      row.normalized.tradeType ?? "",
      row.normalized.quantity ?? "",
      row.normalized.unitPrice ?? "",
      row.normalized.priceCurrency ?? "",
      row.normalized.tradeDate ?? "",
      row.normalized.tradeTimestamp ?? "",
      row.normalized.bookingSequence ?? "",
    ].join("|");
    if (exactDuplicateKeys.has(duplicateKey)) {
      row.state = "duplicate_blocked";
      row.blocking = true;
      row.issues.push({ code: "exact_duplicate", message: "Exact duplicate of an existing posted transaction" });
      continue;
    }

    const dateKey = [
      row.normalized.accountId,
      row.normalized.ticker,
      row.normalized.marketCode,
      row.normalized.tradeDate ?? "",
    ].join("|");
    if (!row.normalized.tradeTimestamp && !row.normalized.bookingSequence && existingSameDayKeys.has(dateKey)) {
      row.state = "invalid";
      row.blocking = true;
      row.issues.push({ code: "same_day_collision", message: "Same-day trades require tradeTimestamp or bookingSequence when posted trades already exist" });
      continue;
    }
    pendingByDateKey.set(dateKey, (pendingByDateKey.get(dateKey) ?? 0) + 1);

    if (!row.normalized.tradeTimestamp && !row.normalized.bookingSequence && pendingByDateKey.get(dateKey)! > 1) {
      row.state = "invalid";
      row.blocking = true;
      row.issues.push({ code: "ambiguous_same_day_order", message: "Same-day trades require tradeTimestamp or bookingSequence to avoid ambiguous ordering" });
      continue;
    }

    if (row.normalized.tradeType === "SELL" && row.normalized.accountId && row.normalized.ticker && row.normalized.quantity) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      const available = runningInventory.get(inventoryKey) ?? 0;
      if (available < row.normalized.quantity) {
        row.state = "invalid";
        row.blocking = true;
        row.issues.push({ code: "negative_inventory", message: "SELL candidate would create negative inventory" });
        continue;
      }
      runningInventory.set(inventoryKey, available - row.normalized.quantity);
    } else if (row.normalized.tradeType === "BUY" && row.normalized.accountId && row.normalized.ticker && row.normalized.quantity) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      const available = runningInventory.get(inventoryKey) ?? 0;
      runningInventory.set(inventoryKey, available + row.normalized.quantity);
    }

    row.warnings = cloneWarnings(row.warnings);
  }

  return {
    rows: baseRows,
    blockingRowCount: baseRows.filter((row) => row.blocking).length,
    unsupportedCount: baseRows.filter((row) => row.state === "unsupported").length,
  };
}

function assertBatchEditable(batch: AiTransactionDraftBatchAggregate["batch"]): void {
  if (batch.status !== "open") {
    throw routeError(409, "mcp_draft_batch_closed", "Draft batch is not open");
  }
}

function requireOwnedBatch(
  deps: McpDraftServiceDeps,
  aggregate: AiTransactionDraftBatchAggregate | null,
  batchId: string,
): AiTransactionDraftBatchAggregate {
  if (!aggregate) {
    throw routeError(404, "mcp_draft_batch_not_found", `Draft batch ${batchId} not found`);
  }
  if (aggregate.batch.ownerUserId !== deps.requestContext.resolvedContext.portfolioContextUserId) {
    throw routeError(403, "mcp_draft_batch_denied", "Draft batch is outside the active portfolio context");
  }
  return aggregate;
}

async function appendDraftEvent(
  deps: McpDraftServiceDeps,
  batchId: string,
  eventType: AiTransactionDraftEventType,
  input: {
    rowId?: string | null;
    summary?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  await deps.app.persistence.appendAiTransactionDraftEvent({
    batchId,
    rowId: input.rowId ?? null,
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    actorUserId: deps.requestContext.auth.sessionUserId,
    connectorConnectionId: deps.requestContext.auth.connection?.id ?? null,
    eventType,
    summary: input.summary ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    metadata: input.metadata ?? {},
    sourceIp: deps.requestContext.sourceIp,
  });
}

export async function getTransactionDraftTemplate() {
  return {
    supportedRecordTypes: ["trade"],
    supportedTradeTypes: ["BUY", "SELL"],
    maxRowsPerBatch: 200,
    requiredFields: ["accountId|accountName", "type", "ticker", "quantity", "unitPrice", "tradeDate"],
    optionalFields: [
      "marketCode",
      "priceCurrency",
      "tradeTimestamp",
      "bookingSequence",
      "isDayTrade",
      "commissionAmount",
      "taxAmount",
      "note",
      "sourceRowRef",
      "sourceSnippet",
    ],
    allowedInference: [
      "marketCode from unambiguous account",
      "priceCurrency from unambiguous account",
      "ticker normalization",
      "isDayTrade defaults to false",
    ],
    blockingChecks: [
      "missing required fields",
      "exact duplicate transactions",
      "same-day collisions without timestamp or sequence",
      "inactive or unknown accounts",
      "unknown or unclassified instruments",
      "negative-inventory SELLs",
      "ambiguous same-day ordering",
    ],
    unsupportedRows: [
      "dividends",
      "cash ledger movements",
      "FX transfers",
      "corporate actions",
      "non-trade rows",
    ],
  };
}

export async function preflightTransactionDraftCandidates(
  deps: McpDraftServiceDeps,
  input: DraftBatchMetadataInput & { candidates: DraftCandidateInput[] },
) {
  ensureMetadataCaps(input);
  const result = await runPreflight(deps, input.candidates);
  return {
    summary: {
      rowCount: input.candidates.length,
      blockingRowCount: result.blockingRowCount,
      unsupportedCount: result.unsupportedCount,
      readyRowCount: result.rows.filter((row) => row.state === "ready").length,
    },
    rows: result.rows.map((row) => ({
      rowNumber: row.rowNumber,
      state: row.state,
      issues: row.issues,
      warnings: row.warnings,
      normalized: row.normalized,
    })),
    unsupportedItems: result.rows
      .filter((row) => row.unsupported)
      .map((row) => ({
        rowNumber: row.rowNumber,
        ...row.unsupported!,
      })),
  };
}

export async function createTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: DraftBatchMetadataInput & { provenance?: Record<string, unknown>; candidates: DraftCandidateInput[] },
): Promise<McpMutationBatchResult> {
  ensureMetadataCaps(input);
  const preflight = await runPreflight(deps, input.candidates);
  if (preflight.blockingRowCount > 0) {
    throw routeError(409, "mcp_draft_preflight_failed", "Draft batch creation blocked by deterministic preflight");
  }
  const batchId = randomUUID();
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const batch = await deps.app.persistence.saveAiTransactionDraftBatch({
    id: batchId,
    ownerUserId: contextUserId,
    createdByUserId: deps.requestContext.auth.sessionUserId,
    connectorConnectionId: deps.requestContext.auth.connection?.id ?? null,
    shareId: deps.requestContext.resolvedContext.shareId,
    sourceChannel: "mcp",
    status: "open",
    version: 1,
    sourceLabel: input.sourceLabel ?? null,
    sourceFilename: input.sourceFilename ?? null,
    note: input.note ?? null,
    provenance: { ...(input.provenance ?? {}) },
    rowCount: input.candidates.length,
    unsupportedCount: preflight.unsupportedCount,
  });
  if (!batch) {
    throw routeError(409, "mcp_draft_batch_conflict", "Draft batch could not be created");
  }

  await Promise.all(preflight.rows.map((row) => deps.app.persistence.saveAiTransactionDraftRow({
    id: randomUUID(),
    batchId,
    ownerUserId: contextUserId,
    rowNumber: row.rowNumber,
    state: row.state,
    version: 1,
    accountId: row.normalized.accountId,
    accountNameInput: row.normalized.accountNameInput,
    tradeType: row.normalized.tradeType,
    ticker: row.normalized.ticker,
    marketCode: row.normalized.marketCode,
    quantity: row.normalized.quantity,
    unitPrice: row.normalized.unitPrice,
    priceCurrency: row.normalized.priceCurrency,
    tradeDate: row.normalized.tradeDate,
    tradeTimestamp: row.normalized.tradeTimestamp,
    bookingSequence: row.normalized.bookingSequence,
    isDayTrade: row.normalized.isDayTrade,
    commissionAmount: row.normalized.commissionAmount,
    taxAmount: row.normalized.taxAmount,
    note: row.normalized.note,
    sourceRowRef: row.normalized.sourceRowRef,
    sourceSnippet: row.normalized.sourceSnippet,
    normalizedPayload: row.normalized.normalizedPayload,
    preflightIssues: row.issues,
    warnings: cloneWarnings(row.warnings),
  })));

  const unsupportedItems = preflight.rows
    .filter((row) => row.unsupported)
    .map((row) => ({
      id: randomUUID(),
      batchId,
      rowNumber: row.rowNumber,
      category: row.unsupported!.category,
      reason: row.unsupported!.reason,
      sourceSnippet: row.unsupported!.sourceSnippet,
      rawPayload: row.unsupported!.rawPayload,
    }));
  if (unsupportedItems.length > 0) {
    await deps.app.persistence.replaceAiTransactionDraftUnsupportedItems(batchId, unsupportedItems);
  }

  await appendDraftEvent(deps, batchId, "batch_created", {
    summary: "Transaction draft batch created over MCP",
    afterState: {
      rowCount: batch.rowCount,
      unsupportedCount: batch.unsupportedCount,
      sourceLabel: batch.sourceLabel,
    },
  });
  await appendDraftEvent(deps, batchId, "preflight_run", {
    summary: "Server-side deterministic preflight completed",
    metadata: {
      blockingRowCount: preflight.blockingRowCount,
      unsupportedCount: preflight.unsupportedCount,
    },
  });

  return {
    batch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batchId, contextUserId),
  };
}

export async function listTransactionDraftBatches(
  deps: McpDraftServiceDeps,
  input: { status?: "open" | "archived" | "deleted"; limit: number },
) {
  const ownerUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const batches = await deps.app.persistence.listAiTransactionDraftBatchesForOwner(ownerUserId);
  return batches
    .filter((batch) => !input.status || batch.status === input.status)
    .slice(0, input.limit)
    .map((batch) => ({
      ...batch,
      deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batch.id, ownerUserId),
    }));
}

export async function getTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  batchId: string,
) {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(batchId), batchId);
  return {
    ...aggregate,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batchId, aggregate.batch.ownerUserId),
  };
}

function mapDraftRowsToCandidates(rows: AiTransactionDraftRowRecord[]): DraftCandidateInput[] {
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    recordType: row.state === "unsupported" ? "unsupported" : "trade",
    accountId: row.accountId ?? undefined,
    accountName: row.accountNameInput ?? undefined,
    type: row.tradeType ?? undefined,
    ticker: row.ticker ?? undefined,
    marketCode: row.marketCode as "TW" | "US" | "AU" | undefined,
    quantity: row.quantity ?? undefined,
    unitPrice: row.unitPrice ?? undefined,
    priceCurrency: row.priceCurrency ?? undefined,
    tradeDate: row.tradeDate ?? undefined,
    tradeTimestamp: row.tradeTimestamp ?? undefined,
    bookingSequence: row.bookingSequence ?? undefined,
    isDayTrade: row.isDayTrade ?? undefined,
    commissionAmount: row.commissionAmount ?? undefined,
    taxAmount: row.taxAmount ?? undefined,
    note: row.note ?? undefined,
    sourceRowRef: row.sourceRowRef ?? undefined,
    sourceSnippet: row.sourceSnippet ?? undefined,
    rawPayload: { ...row.normalizedPayload },
  }));
}

export async function updateTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: {
    batchId: string;
    rows: Array<{
      rowId: string;
      expectedVersion: number;
      patch: Partial<Omit<DraftCandidateInput, "rowNumber">>;
    }>;
  },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  const rowById = new Map(aggregate.rows.map((row) => [row.id, row]));
  const patchById = new Map(input.rows.map((item) => [item.rowId, item]));
  for (const item of input.rows) {
    const current = rowById.get(item.rowId);
    if (!current) throw routeError(404, "mcp_draft_row_not_found", `Draft row ${item.rowId} not found`);
    if (current.version !== item.expectedVersion) {
      throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${item.rowId} version conflict`);
    }
    if (current.state === "confirmed") {
      throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${item.rowId} is already confirmed`);
    }
  }

  const nextCandidates = mapDraftRowsToCandidates(aggregate.rows).map((candidate, index) => {
    const current = aggregate.rows[index]!;
    const patch = patchById.get(current.id)?.patch;
    return patch ? { ...candidate, ...patch, rowNumber: candidate.rowNumber } : candidate;
  });
  const preflight = await runPreflight(deps, nextCandidates);
  const preflightByRowNumber = new Map(preflight.rows.map((row) => [row.rowNumber, row]));

  for (const current of aggregate.rows) {
    if (!patchById.has(current.id)) continue;
    const next = preflightByRowNumber.get(current.rowNumber)!;
    if (next.blocking || next.state === "unsupported") {
      throw routeError(409, "mcp_draft_update_blocked", `Draft row ${current.id} failed deterministic preflight`);
    }
  }

  for (const current of aggregate.rows) {
    if (!patchById.has(current.id)) continue;
    const next = preflightByRowNumber.get(current.rowNumber)!;
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      id: current.id,
      batchId: current.batchId,
      ownerUserId: current.ownerUserId,
      rowNumber: current.rowNumber,
      state: next.state,
      version: current.version + 1,
      accountId: next.normalized.accountId,
      accountNameInput: next.normalized.accountNameInput,
      tradeType: next.normalized.tradeType,
      ticker: next.normalized.ticker,
      marketCode: next.normalized.marketCode,
      quantity: next.normalized.quantity,
      unitPrice: next.normalized.unitPrice,
      priceCurrency: next.normalized.priceCurrency,
      tradeDate: next.normalized.tradeDate,
      tradeTimestamp: next.normalized.tradeTimestamp,
      bookingSequence: next.normalized.bookingSequence,
      isDayTrade: next.normalized.isDayTrade,
      commissionAmount: next.normalized.commissionAmount,
      taxAmount: next.normalized.taxAmount,
      note: next.normalized.note,
      sourceRowRef: next.normalized.sourceRowRef,
      sourceSnippet: next.normalized.sourceSnippet,
      normalizedPayload: next.normalized.normalizedPayload,
      preflightIssues: next.issues,
      warnings: cloneWarnings(next.warnings),
      expectedVersion: current.version,
    });
    if (!saved) {
      throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${current.id} version conflict`);
    }
    await appendDraftEvent(deps, current.batchId, "row_updated", {
      rowId: current.id,
      summary: "Draft row updated over MCP",
      beforeState: {
        state: current.state,
        accountId: current.accountId,
        ticker: current.ticker,
        quantity: current.quantity,
        unitPrice: current.unitPrice,
        tradeDate: current.tradeDate,
      },
      afterState: {
        state: saved.state,
        accountId: saved.accountId,
        ticker: saved.ticker,
        quantity: saved.quantity,
        unitPrice: saved.unitPrice,
        tradeDate: saved.tradeDate,
      },
    });
  }

  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

async function transitionRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
  state: "excluded" | "rejected",
  eventType: AiTransactionDraftEventType,
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const rowIds = new Set(input.rowIds);
  for (const row of aggregate.rows) {
    if (!rowIds.has(row.id)) continue;
    if (row.state === "confirmed") throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${row.id} is already confirmed`);
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      ...row,
      state,
      version: row.version + 1,
      expectedVersion: row.version,
    });
    if (!saved) throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${row.id} version conflict`);
  }
  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, eventType, {
    summary: `${input.rowIds.length} draft rows moved to ${state}`,
    metadata: { rowIds: input.rowIds },
  });
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

export async function excludeTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
) {
  return transitionRows(deps, input, "excluded", "rows_excluded");
}

export async function rejectTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
) {
  return transitionRows(deps, input, "rejected", "rows_rejected");
}

export async function reincludeTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const rowIds = new Set(input.rowIds);
  const nextCandidates = mapDraftRowsToCandidates(aggregate.rows).map((candidate, index) => {
    const current = aggregate.rows[index]!;
    if (!rowIds.has(current.id)) return candidate;
    return { ...candidate, recordType: "trade" as const };
  });
  const preflight = await runPreflight(deps, nextCandidates);
  const byRowNumber = new Map(preflight.rows.map((row) => [row.rowNumber, row]));
  for (const row of aggregate.rows) {
    if (!rowIds.has(row.id)) continue;
    const next = byRowNumber.get(row.rowNumber)!;
    if (next.blocking || next.state === "unsupported") {
      throw routeError(409, "mcp_draft_reinclude_blocked", `Draft row ${row.id} failed deterministic preflight`);
    }
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      ...row,
      state: next.state,
      version: row.version + 1,
      accountId: next.normalized.accountId,
      accountNameInput: next.normalized.accountNameInput,
      tradeType: next.normalized.tradeType,
      ticker: next.normalized.ticker,
      marketCode: next.normalized.marketCode,
      quantity: next.normalized.quantity,
      unitPrice: next.normalized.unitPrice,
      priceCurrency: next.normalized.priceCurrency,
      tradeDate: next.normalized.tradeDate,
      tradeTimestamp: next.normalized.tradeTimestamp,
      bookingSequence: next.normalized.bookingSequence,
      isDayTrade: next.normalized.isDayTrade,
      commissionAmount: next.normalized.commissionAmount,
      taxAmount: next.normalized.taxAmount,
      note: next.normalized.note,
      sourceRowRef: next.normalized.sourceRowRef,
      sourceSnippet: next.normalized.sourceSnippet,
      normalizedPayload: next.normalized.normalizedPayload,
      preflightIssues: next.issues,
      warnings: cloneWarnings(next.warnings),
      expectedVersion: row.version,
    });
    if (!saved) throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${row.id} version conflict`);
  }
  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "rows_reincluded", {
    summary: `${input.rowIds.length} draft rows re-included`,
    metadata: { rowIds: input.rowIds },
  });
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

export async function archiveTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: { batchId: string; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const archived = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    status: "archived",
    version: aggregate.batch.version + 1,
    archivedAt: new Date().toISOString(),
    archivedByUserId: deps.requestContext.auth.sessionUserId,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!archived) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "batch_archived", {
    summary: "Draft batch archived over MCP",
  });
  return {
    batch: archived,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, archived.id, archived.ownerUserId),
  };
}

export async function deleteUnconfirmedTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: { batchId: string; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  if (aggregate.rows.some((row) => row.state === "confirmed" || row.confirmedTradeEventId)) {
    throw routeError(409, "mcp_draft_batch_has_confirmed_rows", "Draft batch contains confirmed rows and cannot be deleted");
  }
  const deleted = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    status: "deleted",
    version: aggregate.batch.version + 1,
    deletedAt: new Date().toISOString(),
    deletedByUserId: deps.requestContext.auth.sessionUserId,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!deleted) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "batch_deleted", {
    summary: "Never-confirmed draft batch deleted over MCP",
  });
  return {
    batch: deleted,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, deleted.id, deleted.ownerUserId),
  };
}
