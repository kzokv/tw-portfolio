import type {
  AccountDefaultCurrency,
  AccountType,
  AiConnectorImportProvenanceDto,
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import type {
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftRowRecord,
} from "../persistence/types.js";
import type { McpDraftServiceDeps, McpReadServiceDeps } from "../mcp/types.js";
import {
  createAccount,
  listMcpAccountDisplays,
  restoreAccount,
  softDeleteAccount,
  updateAccount,
} from "./mcpAccounts.js";
import {
  createTransactionDraftBatch,
  getTransactionDraftBatch,
  getTransactionDraftPostingPreview,
  listTransactionDraftBatches,
  postTransactionDraftRows,
  preflightTransactionDraftCandidates,
  updateTransactionDraftRows,
  excludeTransactionDraftRows,
  rejectTransactionDraftRows,
  reincludeTransactionDraftRows,
  archiveTransactionDraftBatch,
  deleteUnconfirmedTransactionDraftBatch,
  type DraftCandidateInput,
} from "./mcpDrafts.js";
import {
  buildConfirmationDigest,
  buildDraftBatchLabels,
  inferDefaultMarketCode,
  listAccessiblePortfolioContexts,
  portfolioDescriptorForResolvedContext,
  requireMutableRows,
  resolveDraftBatchByLabel,
  resolveRowsByRowNumber,
} from "./mcpNameResolution.js";

interface NameFirstPortfolioRef {
  label: string;
  email: string | null;
  isDelegated: boolean;
}

interface ConfirmationFields {
  confirmationSummary?: string;
  confirmationDigest?: string;
}

function duplicateNameWarnings(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => `Duplicate account name "${name}" is present. Name-first operations require unique account names.`);
}

function normalizeAccountName(value: string): string {
  return value.trim().toLowerCase();
}

async function loadActiveAccounts(deps: McpDraftServiceDeps) {
  const { accounts } = await listMcpAccountDisplays(deps, { includeDeleted: false });
  return accounts;
}

async function loadDeletedAccounts(deps: McpDraftServiceDeps) {
  const { deletedAccounts } = await listMcpAccountDisplays(deps, { includeDeleted: true });
  return deletedAccounts;
}

function resolveUniqueActiveAccountByName(
  accounts: Awaited<ReturnType<typeof loadActiveAccounts>>,
  accountName: string,
) {
  const matches = accounts.filter((account) => normalizeAccountName(account.name) === normalizeAccountName(accountName));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw routeError(404, "mcp_account_not_found", `Active account named ${accountName} was not found`);
  }
  throw routeError(
    409,
    "mcp_account_name_ambiguous",
    `Active account name ${accountName} matched multiple accounts. Rename duplicate accounts before using name-first MCP tools.`,
  );
}

function resolveUniqueDeletedAccountByName(
  accounts: Awaited<ReturnType<typeof loadDeletedAccounts>>,
  accountName: string,
) {
  const matches = accounts.filter((account) => normalizeAccountName(account.name) === normalizeAccountName(accountName));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw routeError(404, "mcp_deleted_account_not_found", `Deleted account named ${accountName} was not found`);
  }
  throw routeError(
    409,
    "mcp_deleted_account_name_ambiguous",
    `Deleted account name ${accountName} matched multiple accounts. Restore by name requires a unique deleted account name.`,
  );
}

function predictRestoredAccountName(
  priorName: string,
  activeAccounts: Awaited<ReturnType<typeof loadActiveAccounts>>,
): string {
  const activeNames = new Set(activeAccounts.map((account) => account.name));
  if (!activeNames.has(priorName)) return priorName;
  let finalName = `${priorName} (restored)`;
  let suffix = 2;
  while (activeNames.has(finalName) && suffix <= 20) {
    finalName = `${priorName} (restored ${suffix})`;
    suffix += 1;
  }
  if (activeNames.has(finalName)) {
    throw routeError(
      409,
      "account_restore_name_unresolvable",
      "Could not auto-rename restored account: too many active name collisions.",
    );
  }
  return finalName;
}

function batchLabelFor(batch: AiTransactionDraftBatchRecord, labels: Map<string, string>): string {
  return labels.get(batch.id) ?? batch.sourceLabel ?? batch.sourceFilename ?? batch.id;
}

function toPortfolioRef(deps: McpDraftServiceDeps | McpReadServiceDeps): NameFirstPortfolioRef {
  return portfolioDescriptorForResolvedContext(
    deps.requestContext,
    deps.requestContext.portfolioContextDescriptor
      ? {
          userId: deps.requestContext.resolvedContext.portfolioContextUserId,
          label: deps.requestContext.portfolioContextDescriptor.label,
          email: deps.requestContext.portfolioContextDescriptor.email,
          isSelf: deps.requestContext.portfolioContextDescriptor.isSelf,
          shareId: deps.requestContext.resolvedContext.shareId,
          capabilities: deps.requestContext.resolvedContext.shareCapabilities,
        }
      : null,
  );
}

function withPortfolio<T extends Record<string, unknown>>(
  deps: McpDraftServiceDeps | McpReadServiceDeps,
  payload: T,
) {
  return {
    portfolio: toPortfolioRef(deps),
    ...payload,
  };
}

function formatDraftRow(row: AiTransactionDraftRowRecord, accountName: string | null) {
  return {
    rowNumber: row.rowNumber,
    state: row.state,
    accountName,
    type: row.tradeType,
    ticker: row.ticker,
    marketCode: row.marketCode,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    priceCurrency: row.priceCurrency,
    tradeDate: row.tradeDate,
    tradeTimestamp: row.tradeTimestamp,
    bookingSequence: row.bookingSequence,
    isDayTrade: row.isDayTrade,
    commissionAmount: row.commissionAmount,
    taxAmount: row.taxAmount,
    note: row.note,
    warnings: row.warnings,
    issues: row.preflightIssues,
    confirmedAt: row.confirmedAt,
  };
}

async function loadBatchAggregateByLabel(
  deps: McpDraftServiceDeps,
  batchLabel: string,
): Promise<{ aggregate: AiTransactionDraftBatchAggregate; resolvedLabel: string; labels: Map<string, string> }> {
  const batches = await listTransactionDraftBatches(deps, { limit: 500 });
  const rawBatches = batches.map(({ deepLinkUrl: _deepLinkUrl, ...batch }) => batch);
  const labels = buildDraftBatchLabels(rawBatches);
  const resolved = resolveDraftBatchByLabel(rawBatches, batchLabel);
  const aggregate = await getTransactionDraftBatch(deps, resolved.batch.id);
  return { aggregate, resolvedLabel: resolved.batchLabel, labels };
}

function summarizeRowsForConfirmation(
  action: string,
  batchLabel: string,
  rows: Array<{
    rowNumber: number;
    accountName: string | null;
    type: string | null;
    ticker: string | null;
    quantity: number | null;
    unitPrice: number | null;
    priceCurrency: string | null;
  }>,
): string {
  if (rows.length <= 20) {
    const detail = rows
      .slice()
      .sort((left, right) => left.rowNumber - right.rowNumber)
      .map((row) => {
        const quantity = row.quantity ?? "?";
        const unitPrice = row.unitPrice ?? "?";
        const currency = row.priceCurrency ?? "";
        return `Row ${row.rowNumber}: ${row.accountName ?? "Unknown account"} ${row.type ?? "?"} ${quantity} ${row.ticker ?? "?"} @ ${unitPrice} ${currency}`.trim();
      });
    return `${action} in batch "${batchLabel}". Review rows: ${detail.join("; ")}`;
  }

  const accounts = [...new Set(rows.map((row) => row.accountName).filter((value): value is string => Boolean(value)))].sort();
  const tickers = [...new Set(rows.map((row) => row.ticker).filter((value): value is string => Boolean(value)))].sort();
  const totalNotional = rows.reduce((sum, row) => (
    row.quantity !== null && row.unitPrice !== null ? sum + row.quantity * row.unitPrice : sum
  ), 0);
  return `${action} ${rows.length} rows in batch "${batchLabel}". Accounts: ${accounts.join(", ") || "unknown"}. Tickers: ${tickers.join(", ") || "unknown"}. Gross notional: ${totalNotional.toFixed(2)}. Review the batch carefully before confirming this bulk operation.`;
}

function assertConfirmationMatches(
  provided: ConfirmationFields,
  expectedSummary: string,
  digestPayload: Record<string, unknown>,
): string {
  const expectedDigest = buildConfirmationDigest(digestPayload);
  if (!provided.confirmationSummary || !provided.confirmationDigest) {
    throw routeError(
      409,
      "mcp_confirmation_required",
      "confirmationSummary and confirmationDigest are required. Retry with the latest confirmation payload from the preview response.",
      { expectedSummary, expectedDigest },
    );
  }
  if (provided.confirmationSummary !== expectedSummary || provided.confirmationDigest !== expectedDigest) {
    throw routeError(
      409,
      "mcp_confirmation_stale",
      "The supplied confirmationSummary or confirmationDigest is stale. Re-run the preview/get tool and confirm again.",
      { expectedSummary, expectedDigest },
    );
  }
  return expectedDigest;
}

function previewResponse<T extends Record<string, unknown>>(
  payload: T,
  digestPayload: Record<string, unknown>,
) {
  return {
    ...payload,
    confirmationDigest: buildConfirmationDigest(digestPayload),
    requiresConfirmation: true,
  };
}

export async function listPortfolioContexts(deps: McpReadServiceDeps) {
  const contexts = await listAccessiblePortfolioContexts(deps.app, deps.requestContext.auth);
  return {
    portfolios: contexts.map((context) => ({
      label: context.label,
      email: context.email,
      isSelf: context.isSelf,
      capabilities: context.capabilities,
    })),
    _meta: {
      portfolios: contexts.map((context) => ({
        userId: context.userId,
        shareId: context.shareId,
      })),
    },
  };
}

export async function listDraftableAccountNames(deps: McpDraftServiceDeps) {
  const accounts = await loadActiveAccounts(deps);
  return withPortfolio(deps, {
    accounts: accounts
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((account) => ({
        name: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        marketCode: inferDefaultMarketCode(account.defaultCurrency),
      })),
    warnings: duplicateNameWarnings(accounts.map((account) => account.name)),
  });
}

export async function listAccountNames(
  deps: McpDraftServiceDeps,
  input: { includeDeleted?: boolean } = {},
) {
  const { accounts, deletedAccounts } = await listMcpAccountDisplays(deps, { includeDeleted: input.includeDeleted });
  return withPortfolio(deps, {
    accounts: [
      ...accounts.map((account) => ({
        name: account.name,
        status: "active" as const,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        deletedAt: null,
      })),
      ...deletedAccounts.map((account) => ({
        name: account.name,
        status: "deleted" as const,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        deletedAt: account.deletedAt,
      })),
    ].sort((left, right) => left.name.localeCompare(right.name)),
    warnings: duplicateNameWarnings([
      ...accounts.map((account) => account.name),
      ...deletedAccounts.map((account) => account.name),
    ]),
  });
}

export async function previewCreateAccountByName(
  deps: McpDraftServiceDeps,
  input: { name: string; defaultCurrency: AccountDefaultCurrency; accountType: AccountType },
) {
  const accounts = await loadActiveAccounts(deps);
  if (accounts.some((account) => normalizeAccountName(account.name) === normalizeAccountName(input.name))) {
    throw routeError(409, "account_name_in_use", "An account with that name already exists.");
  }
  const confirmationSummary = `Create ${input.accountType} account "${input.name.trim()}" with default currency ${input.defaultCurrency}.`;
  return previewResponse(
    withPortfolio(deps, {
      action: "create_account_by_name",
      account: {
        name: input.name.trim(),
        accountType: input.accountType,
        defaultCurrency: input.defaultCurrency,
      },
      confirmationSummary,
    }),
    {
      action: "create_account_by_name",
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      name: input.name.trim(),
      accountType: input.accountType,
      defaultCurrency: input.defaultCurrency,
    },
  );
}

export async function createAccountByName(
  deps: McpDraftServiceDeps,
  input: { name: string; defaultCurrency: AccountDefaultCurrency; accountType: AccountType } & Required<ConfirmationFields>,
) {
  const preview = await previewCreateAccountByName(deps, input);
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "create_account_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    name: input.name.trim(),
    accountType: input.accountType,
    defaultCurrency: input.defaultCurrency,
  });
  const created = await createAccount(deps, input);
  return {
    ...withPortfolio(deps, {
      account: {
        name: created.account.name,
        accountType: created.account.accountType,
        defaultCurrency: created.account.defaultCurrency,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      accountId: created.account.id,
    },
  };
}

export async function previewUpdateAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string; name?: string; accountType?: AccountType },
) {
  if (input.name === undefined && input.accountType === undefined) {
    throw routeError(400, "mcp_account_update_empty", "At least one of name or accountType must be provided");
  }
  const accounts = await loadActiveAccounts(deps);
  const account = resolveUniqueActiveAccountByName(accounts, input.accountName);
  if (
    input.name !== undefined
    && accounts.some((candidate) => candidate.id !== account.id && normalizeAccountName(candidate.name) === normalizeAccountName(input.name!))
  ) {
    throw routeError(409, "account_name_in_use", "An account with that name already exists.");
  }
  const nextName = input.name?.trim() ?? account.name;
  const nextType = input.accountType ?? account.accountType;
  const confirmationSummary = `Update account "${account.name}" to name "${nextName}" and type ${nextType}.`;
  return previewResponse(
    withPortfolio(deps, {
      action: "update_account_by_name",
      account: {
        accountName: account.name,
        nextName,
        nextAccountType: nextType,
      },
      confirmationSummary,
    }),
    {
      action: "update_account_by_name",
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      accountId: account.id,
      currentName: account.name,
      currentAccountType: account.accountType,
      nextName,
      nextAccountType: nextType,
    },
  );
}

export async function updateAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string; name?: string; accountType?: AccountType } & Required<ConfirmationFields>,
) {
  const preview = await previewUpdateAccountByName(deps, input);
  const accounts = await loadActiveAccounts(deps);
  const account = resolveUniqueActiveAccountByName(accounts, input.accountName);
  const nextName = input.name?.trim() ?? account.name;
  const nextType = input.accountType ?? account.accountType;
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "update_account_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    accountId: account.id,
    currentName: account.name,
    currentAccountType: account.accountType,
    nextName,
    nextAccountType: nextType,
  });
  const updated = await updateAccount(deps, {
    accountName: input.accountName,
    name: input.name,
    accountType: input.accountType,
  });
  return {
    ...withPortfolio(deps, {
      account: {
        name: updated.account.name,
        accountType: updated.account.accountType,
        defaultCurrency: updated.account.defaultCurrency,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      accountId: updated.account.id,
    },
  };
}

export async function previewSoftDeleteAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string },
) {
  const accounts = await loadActiveAccounts(deps);
  const account = resolveUniqueActiveAccountByName(accounts, input.accountName);
  const confirmationSummary = `Soft-delete account "${account.name}".`;
  return previewResponse(
    withPortfolio(deps, {
      action: "soft_delete_account_by_name",
      account: {
        name: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
      },
      confirmationSummary,
    }),
    {
      action: "soft_delete_account_by_name",
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      accountId: account.id,
      accountName: account.name,
    },
  );
}

export async function softDeleteAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string } & Required<ConfirmationFields>,
) {
  const preview = await previewSoftDeleteAccountByName(deps, input);
  const accounts = await loadActiveAccounts(deps);
  const account = resolveUniqueActiveAccountByName(accounts, input.accountName);
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "soft_delete_account_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    accountId: account.id,
    accountName: account.name,
  });
  const deleted = await softDeleteAccount(deps, { accountName: input.accountName });
  return {
    ...withPortfolio(deps, {
      account: {
        name: deleted.accountName,
        deletedAt: deleted.deletedAt,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      accountId: deleted.accountId,
    },
  };
}

export async function previewRestoreAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string },
) {
  const deletedAccounts = await loadDeletedAccounts(deps);
  const activeAccounts = await loadActiveAccounts(deps);
  const account = resolveUniqueDeletedAccountByName(deletedAccounts, input.accountName);
  const finalName = predictRestoredAccountName(account.name, activeAccounts);
  const confirmationSummary = account.name === finalName
    ? `Restore deleted account "${account.name}".`
    : `Restore deleted account "${account.name}" as "${finalName}" because the active name is already in use.`;
  return previewResponse(
    withPortfolio(deps, {
      action: "restore_account_by_name",
      account: {
        deletedName: account.name,
        finalName,
        deletedAt: account.deletedAt,
      },
      confirmationSummary,
    }),
    {
      action: "restore_account_by_name",
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      accountId: account.id,
      deletedName: account.name,
      finalName,
      deletedAt: account.deletedAt,
    },
  );
}

export async function restoreAccountByName(
  deps: McpDraftServiceDeps,
  input: { accountName: string } & Required<ConfirmationFields>,
) {
  const preview = await previewRestoreAccountByName(deps, input);
  const deletedAccounts = await loadDeletedAccounts(deps);
  const activeAccounts = await loadActiveAccounts(deps);
  const account = resolveUniqueDeletedAccountByName(deletedAccounts, input.accountName);
  const finalName = predictRestoredAccountName(account.name, activeAccounts);
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "restore_account_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    accountId: account.id,
    deletedName: account.name,
    finalName,
    deletedAt: account.deletedAt,
  });
  const restored = await restoreAccount(deps, { accountId: account.id });
  return {
    ...withPortfolio(deps, {
      account: {
        requestedName: account.name,
        finalName: restored.finalName,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      accountId: restored.accountId,
    },
  };
}

function ensureNameOnlyCandidates(candidates: DraftCandidateInput[]): void {
  for (const candidate of candidates) {
    if (candidate.accountId) {
      throw routeError(400, "mcp_account_id_forbidden", "Model-facing _by_name draft tools do not accept accountId. Use accountName only.");
    }
  }
}

function sanitizePreflightRows(result: Awaited<ReturnType<typeof preflightTransactionDraftCandidates>>) {
  return result.rows.map((row) => ({
    rowNumber: row.rowNumber,
    state: row.state,
    issues: row.issues,
    warnings: row.warnings,
    normalized: {
      accountName: row.normalized.accountNameInput,
      type: row.normalized.tradeType,
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
    },
  }));
}

export async function preflightTransactionDraftCandidatesByName(
  deps: McpDraftServiceDeps,
  input: {
    sourceLabel?: string;
    sourceFilename?: string;
    note?: string;
    provenance?: AiConnectorImportProvenanceDto;
    candidates: DraftCandidateInput[];
  },
) {
  ensureNameOnlyCandidates(input.candidates);
  const result = await preflightTransactionDraftCandidates(deps, input);
  const confirmationSummary = summarizeRowsForConfirmation(
    "Create transaction draft batch",
    input.sourceLabel?.trim() || input.sourceFilename?.trim() || "New draft batch",
    result.rows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.normalized.accountNameInput,
      type: row.normalized.tradeType,
      ticker: row.normalized.ticker,
      quantity: row.normalized.quantity,
      unitPrice: row.normalized.unitPrice,
      priceCurrency: row.normalized.priceCurrency,
    })),
  );
  return previewResponse(
    withPortfolio(deps, {
      summary: result.summary,
      rows: sanitizePreflightRows(result),
      unsupportedItems: result.unsupportedItems,
      confirmationSummary,
    }),
    {
      action: "create_transaction_draft_batch_by_name",
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      sourceLabel: input.sourceLabel?.trim() ?? null,
      sourceFilename: input.sourceFilename?.trim() ?? null,
      note: input.note?.trim() ?? null,
      candidates: sanitizePreflightRows(result),
    },
  );
}

export async function createTransactionDraftBatchByName(
  deps: McpDraftServiceDeps,
  input: {
    sourceLabel?: string;
    sourceFilename?: string;
    note?: string;
    provenance?: AiConnectorImportProvenanceDto;
    candidates: DraftCandidateInput[];
  } & Required<ConfirmationFields>,
) {
  const preview = await preflightTransactionDraftCandidatesByName(deps, input);
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "create_transaction_draft_batch_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    sourceLabel: input.sourceLabel?.trim() ?? null,
    sourceFilename: input.sourceFilename?.trim() ?? null,
    note: input.note?.trim() ?? null,
    candidates: preview.rows,
  });
  const created = await createTransactionDraftBatch(deps, input);
  const labels = buildDraftBatchLabels([created.batch]);
  return {
    ...withPortfolio(deps, {
      batch: {
        batchLabel: batchLabelFor(created.batch, labels),
        status: created.batch.status,
        rowCount: created.batch.rowCount,
        unsupportedCount: created.batch.unsupportedCount,
        sourceLabel: created.batch.sourceLabel,
        sourceFilename: created.batch.sourceFilename,
        note: created.batch.note,
        createdAt: created.batch.createdAt,
        updatedAt: created.batch.updatedAt,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      batchId: created.batch.id,
      deepLinkUrl: created.deepLinkUrl,
    },
  };
}

export async function listTransactionDraftBatchesByName(
  deps: McpDraftServiceDeps,
  input: { status?: "open" | "archived" | "deleted"; limit: number },
) {
  const batches = await listTransactionDraftBatches(deps, input);
  const rawBatches = batches.map(({ deepLinkUrl: _deepLinkUrl, ...batch }) => batch);
  const labels = buildDraftBatchLabels(rawBatches);
  return withPortfolio(deps, {
    batches: rawBatches.map((batch) => ({
      batchLabel: batchLabelFor(batch, labels),
      status: batch.status,
      rowCount: batch.rowCount,
      unsupportedCount: batch.unsupportedCount,
      sourceLabel: batch.sourceLabel,
      sourceFilename: batch.sourceFilename,
      note: batch.note,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    })),
  });
}

function sanitizeBatchAggregate(
  aggregate: AiTransactionDraftBatchAggregate,
  batchLabel: string,
) {
  const accountNamesById = new Map<string, string>();
  for (const row of aggregate.rows) {
    if (row.accountId && row.accountNameInput) {
      accountNamesById.set(row.accountId, row.accountNameInput);
    }
  }
  return {
    batch: {
      batchLabel,
      status: aggregate.batch.status,
      sourceLabel: aggregate.batch.sourceLabel,
      sourceFilename: aggregate.batch.sourceFilename,
      note: aggregate.batch.note,
      rowCount: aggregate.batch.rowCount,
      unsupportedCount: aggregate.batch.unsupportedCount,
      createdAt: aggregate.batch.createdAt,
      updatedAt: aggregate.batch.updatedAt,
    },
    rows: aggregate.rows
      .slice()
      .sort((left, right) => left.rowNumber - right.rowNumber)
      .map((row) => formatDraftRow(row, row.accountNameInput ?? (row.accountId ? accountNamesById.get(row.accountId) ?? null : null))),
    unsupportedItems: aggregate.unsupportedItems
      .slice()
      .sort((left, right) => (left.rowNumber ?? Number.MAX_SAFE_INTEGER) - (right.rowNumber ?? Number.MAX_SAFE_INTEGER))
      .map((item) => ({
        rowNumber: item.rowNumber,
        category: item.category,
        reason: item.reason,
        sourceSnippet: item.sourceSnippet,
      })),
    events: aggregate.events
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((event) => ({
        eventType: event.eventType,
        summary: event.summary,
        createdAt: event.createdAt,
      })),
  };
}

export async function getTransactionDraftBatchByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string },
) {
  const { aggregate, resolvedLabel } = await loadBatchAggregateByLabel(deps, input.batchLabel);
  const sanitized = sanitizeBatchAggregate(aggregate, resolvedLabel);
  const confirmationSummary = summarizeRowsForConfirmation(
    "Review draft batch",
    resolvedLabel,
    sanitized.rows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.accountName,
      type: row.type,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
    })),
  );
  return {
    ...withPortfolio(deps, {
      ...sanitized,
      confirmationSummary,
      confirmationDigest: buildConfirmationDigest({
        action: "get_transaction_draft_batch_by_name",
        ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
        batchId: aggregate.batch.id,
        batchVersion: aggregate.batch.version,
        rows: sanitized.rows,
      }),
    }),
    _meta: {
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      rowIdsByRowNumber: Object.fromEntries(aggregate.rows.map((row) => [String(row.rowNumber), row.id])),
      rowVersionsByRowNumber: Object.fromEntries(aggregate.rows.map((row) => [String(row.rowNumber), row.version])),
    },
  };
}

export async function showTransactionDraftBatchByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string },
) {
  const detail = await getTransactionDraftBatchByName(deps, input);
  return {
    ...detail,
    summary: {
      batchLabel: detail.batch.batchLabel,
      status: detail.batch.status,
      rowCount: detail.batch.rowCount,
      readyRowCount: detail.rows.filter((row) => row.state === "ready").length,
      unresolvedRowCount: detail.rows.filter((row) => row.state !== "ready" && row.state !== "confirmed").length,
      confirmedRowCount: detail.rows.filter((row) => row.state === "confirmed").length,
    },
  };
}

type DraftRowPatch = Partial<Omit<DraftCandidateInput, "rowNumber" | "accountId">>;

async function previewDraftRowMutation(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers: number[]; action: string; rows?: Array<{ rowNumber: number; patch: DraftRowPatch }> },
) {
  const { aggregate, resolvedLabel } = await loadBatchAggregateByLabel(deps, input.batchLabel);
  const resolvedRows = resolveRowsByRowNumber(aggregate, input.rowNumbers);
  requireMutableRows(resolvedRows.rows, input.action);

  let previewRows = resolvedRows.rows;
  if (input.rows) {
    const patchByRowNumber = new Map(input.rows.map((row) => [row.rowNumber, row.patch]));
    previewRows = resolvedRows.rows.map((row) => {
      const patch = patchByRowNumber.get(row.rowNumber);
      return patch
        ? {
            ...row,
            accountNameInput: patch.accountName ?? row.accountNameInput,
            tradeType: patch.type ?? row.tradeType,
            ticker: patch.ticker ?? row.ticker,
            marketCode: patch.marketCode ?? row.marketCode,
            quantity: patch.quantity ?? row.quantity,
            unitPrice: patch.unitPrice ?? row.unitPrice,
            priceCurrency: patch.priceCurrency ?? row.priceCurrency,
            tradeDate: patch.tradeDate ?? row.tradeDate,
            tradeTimestamp: patch.tradeTimestamp ?? row.tradeTimestamp,
            bookingSequence: patch.bookingSequence ?? row.bookingSequence,
            isDayTrade: patch.isDayTrade ?? row.isDayTrade,
            commissionAmount: patch.commissionAmount ?? row.commissionAmount,
            taxAmount: patch.taxAmount ?? row.taxAmount,
            note: patch.note ?? row.note,
            sourceRowRef: patch.sourceRowRef ?? row.sourceRowRef,
            sourceSnippet: patch.sourceSnippet ?? row.sourceSnippet,
          }
        : row;
    });
  }

  const confirmationSummary = summarizeRowsForConfirmation(
    input.action,
    resolvedLabel,
    previewRows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.accountNameInput,
      type: row.tradeType,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
    })),
  );

  return {
    aggregate,
    resolvedLabel,
    confirmationSummary,
    digestPayload: {
      action: input.action,
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      rowNumbers: previewRows.map((row) => row.rowNumber),
      rows: previewRows.map((row) => ({
        rowNumber: row.rowNumber,
        state: row.state,
        accountName: row.accountNameInput,
        type: row.tradeType,
        ticker: row.ticker,
        marketCode: row.marketCode,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        priceCurrency: row.priceCurrency,
        tradeDate: row.tradeDate,
        tradeTimestamp: row.tradeTimestamp,
        bookingSequence: row.bookingSequence,
        isDayTrade: row.isDayTrade,
        commissionAmount: row.commissionAmount,
        taxAmount: row.taxAmount,
        note: row.note,
      })),
    },
    rows: previewRows,
  };
}

export async function updateTransactionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: {
    batchLabel: string;
    rows: Array<{ rowNumber: number; patch: DraftRowPatch }>;
  } & ConfirmationFields,
) {
  const rowNumbers = input.rows.map((row) => row.rowNumber);
  const preview = await previewDraftRowMutation(deps, {
    batchLabel: input.batchLabel,
    rowNumbers,
    rows: input.rows,
    action: "Update draft rows",
  });
  if (!input.confirmationSummary || !input.confirmationDigest) {
    return previewResponse(
      withPortfolio(deps, {
        batchLabel: preview.resolvedLabel,
        rows: preview.rows.map((row) => formatDraftRow(row, row.accountNameInput)),
        confirmationSummary: preview.confirmationSummary,
      }),
      preview.digestPayload,
    );
  }
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, preview.digestPayload);
  const resolvedRows = resolveRowsByRowNumber(preview.aggregate, rowNumbers);
  const updated = await updateTransactionDraftRows(deps, {
    batchId: preview.aggregate.batch.id,
    rows: input.rows.map((row) => {
      const current = resolvedRows.rows.find((candidate) => candidate.rowNumber === row.rowNumber)!;
      return {
        rowId: current.id,
        expectedVersion: current.version,
        patch: row.patch,
      };
    }),
  });
  return {
    ...withPortfolio(deps, {
      batch: {
        batchLabel: preview.resolvedLabel,
        status: updated.batch.status,
        rowCount: updated.batch.rowCount,
        unsupportedCount: updated.batch.unsupportedCount,
        updatedAt: updated.batch.updatedAt,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      batchId: updated.batch.id,
      deepLinkUrl: updated.deepLinkUrl,
    },
  };
}

async function transitionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers: number[] } & ConfirmationFields,
  action: string,
  transition: (deps: McpDraftServiceDeps, input: { batchId: string; rowIds: string[]; expectedBatchVersion: number }) => Promise<{ batch: AiTransactionDraftBatchRecord; deepLinkUrl: string }>,
) {
  const preview = await previewDraftRowMutation(deps, {
    batchLabel: input.batchLabel,
    rowNumbers: input.rowNumbers,
    action,
  });
  if (!input.confirmationSummary || !input.confirmationDigest) {
    return previewResponse(
      withPortfolio(deps, {
        batchLabel: preview.resolvedLabel,
        rows: preview.rows.map((row) => formatDraftRow(row, row.accountNameInput)),
        confirmationSummary: preview.confirmationSummary,
      }),
      preview.digestPayload,
    );
  }
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, preview.digestPayload);
  const resolvedRows = resolveRowsByRowNumber(preview.aggregate, input.rowNumbers);
  const transitioned = await transition(deps, {
    batchId: preview.aggregate.batch.id,
    rowIds: resolvedRows.rowIds,
    expectedBatchVersion: preview.aggregate.batch.version,
  });
  return {
    ...withPortfolio(deps, {
      batch: {
        batchLabel: preview.resolvedLabel,
        status: transitioned.batch.status,
        rowCount: transitioned.batch.rowCount,
        unsupportedCount: transitioned.batch.unsupportedCount,
        updatedAt: transitioned.batch.updatedAt,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      batchId: transitioned.batch.id,
      deepLinkUrl: transitioned.deepLinkUrl,
    },
  };
}

export async function excludeTransactionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers: number[] } & ConfirmationFields,
) {
  return transitionDraftRowsByName(deps, input, "Exclude draft rows", excludeTransactionDraftRows);
}

export async function rejectTransactionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers: number[] } & ConfirmationFields,
) {
  return transitionDraftRowsByName(deps, input, "Reject draft rows", rejectTransactionDraftRows);
}

export async function reincludeTransactionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers: number[] } & ConfirmationFields,
) {
  return transitionDraftRowsByName(deps, input, "Reinclude draft rows", reincludeTransactionDraftRows);
}

async function previewWholeBatchMutation(
  deps: McpDraftServiceDeps,
  batchLabel: string,
  action: string,
) {
  const { aggregate, resolvedLabel } = await loadBatchAggregateByLabel(deps, batchLabel);
  const confirmationSummary = summarizeRowsForConfirmation(
    action,
    resolvedLabel,
    aggregate.rows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.accountNameInput,
      type: row.tradeType,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
    })),
  );
  return {
    aggregate,
    resolvedLabel,
    confirmationSummary,
    digestPayload: {
      action,
      ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      status: aggregate.batch.status,
      rowCount: aggregate.batch.rowCount,
      unsupportedCount: aggregate.batch.unsupportedCount,
    },
  };
}

async function wholeBatchMutationByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string } & ConfirmationFields,
  action: string,
  mutation: (deps: McpDraftServiceDeps, input: { batchId: string; expectedBatchVersion: number }) => Promise<{ batch: AiTransactionDraftBatchRecord; deepLinkUrl: string }>,
) {
  const preview = await previewWholeBatchMutation(deps, input.batchLabel, action);
  if (!input.confirmationSummary || !input.confirmationDigest) {
    return previewResponse(
      withPortfolio(deps, {
        batchLabel: preview.resolvedLabel,
        confirmationSummary: preview.confirmationSummary,
      }),
      preview.digestPayload,
    );
  }
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, preview.digestPayload);
  const mutated = await mutation(deps, {
    batchId: preview.aggregate.batch.id,
    expectedBatchVersion: preview.aggregate.batch.version,
  });
  return {
    ...withPortfolio(deps, {
      batch: {
        batchLabel: preview.resolvedLabel,
        status: mutated.batch.status,
        rowCount: mutated.batch.rowCount,
        unsupportedCount: mutated.batch.unsupportedCount,
        updatedAt: mutated.batch.updatedAt,
      },
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: digest,
    }),
    _meta: {
      batchId: mutated.batch.id,
      deepLinkUrl: mutated.deepLinkUrl,
    },
  };
}

export async function archiveTransactionDraftBatchByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string } & ConfirmationFields,
) {
  return wholeBatchMutationByName(deps, input, "Archive draft batch", archiveTransactionDraftBatch);
}

export async function deleteUnconfirmedTransactionDraftBatchByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string } & ConfirmationFields,
) {
  return wholeBatchMutationByName(deps, input, "Delete unconfirmed draft batch", deleteUnconfirmedTransactionDraftBatch);
}

export async function getTransactionDraftPostingPreviewByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers?: number[] },
) {
  const { aggregate, resolvedLabel } = await loadBatchAggregateByLabel(deps, input.batchLabel);
  const resolvedRows = input.rowNumbers && input.rowNumbers.length > 0
    ? resolveRowsByRowNumber(aggregate, input.rowNumbers)
    : {
        rowIds: aggregate.rows.filter((row) => row.state === "ready").map((row) => row.id),
        rowNumbers: aggregate.rows.filter((row) => row.state === "ready").map((row) => row.rowNumber),
        rows: aggregate.rows.filter((row) => row.state === "ready"),
      };
  const preview = await getTransactionDraftPostingPreview(deps, {
    batchId: aggregate.batch.id,
    expectedBatchVersion: aggregate.batch.version,
    rowIds: resolvedRows.rowIds,
  });
  const modelPreview = {
    rows: preview.rows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.accountName,
      accountType: row.accountType,
      accountDefaultCurrency: row.accountDefaultCurrency,
      ticker: row.ticker,
      marketCode: row.marketCode,
      type: row.type,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
      tradeDate: row.tradeDate,
      grossValueAmount: row.grossValueAmount,
      commissionAmount: row.commissionAmount,
      taxAmount: row.taxAmount,
      calculatedCommissionAmount: row.calculatedCommissionAmount,
      calculatedTaxAmount: row.calculatedTaxAmount,
      feesSource: row.feesSource,
      netCashImpactAmount: row.netCashImpactAmount,
      warnings: row.warnings,
      suggestions: row.suggestions,
      sourceSnippet: row.sourceSnippet,
    })),
    groups: preview.groups.map((group) => ({
      accountName: group.accountName,
      currency: group.currency,
      rowCount: group.rowCount,
      totalGrossBuyAmount: group.totalGrossBuyAmount,
      totalGrossSellAmount: group.totalGrossSellAmount,
      totalCommissionAmount: group.totalCommissionAmount,
      totalTaxAmount: group.totalTaxAmount,
      netCashImpactAmount: group.netCashImpactAmount,
    })),
    warnings: preview.warnings,
    suggestions: preview.suggestions,
    typedPhraseRequired: preview.typedPhraseRequired,
  };
  const confirmationSummary = summarizeRowsForConfirmation(
    "Post draft rows",
    resolvedLabel,
    resolvedRows.rows.map((row) => ({
      rowNumber: row.rowNumber,
      accountName: row.accountNameInput,
      type: row.tradeType,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
    })),
  );
  return {
    ...withPortfolio(deps, {
      batchLabel: resolvedLabel,
      rowNumbers: resolvedRows.rowNumbers,
      preview: modelPreview,
      confirmationSummary,
      confirmationDigest: buildConfirmationDigest({
        action: "post_transaction_draft_rows_by_name",
        ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
        batchId: aggregate.batch.id,
        batchVersion: aggregate.batch.version,
        rowNumbers: resolvedRows.rowNumbers,
        preview: modelPreview,
      }),
    }),
    _meta: {
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      rowIds: resolvedRows.rowIds,
      rowVersions: resolvedRows.rows.map((row) => ({ rowId: row.id, expectedVersion: row.version })),
      rowNumbersByRowId: Object.fromEntries(resolvedRows.rows.map((row) => [row.id, row.rowNumber])),
    },
  };
}

export async function postTransactionDraftRowsByName(
  deps: McpDraftServiceDeps,
  input: { batchLabel: string; rowNumbers?: number[]; typedConfirmation?: string; idempotencyKey: string } & Required<ConfirmationFields>,
): Promise<{
  outcome: string;
  portfolio: NameFirstPortfolioRef;
  batchLabel: string;
  batchVersion: number;
  postedRowNumbers: number[];
  createdTransactionCount: number;
  remainingUnresolvedRowNumbers: number[];
  confirmation: Record<string, unknown>;
  rowErrors: Array<{ rowNumber: number | null; state: string; issues: unknown[] }>;
  confirmationSummary: string;
  confirmationDigest: string;
  _meta: Record<string, unknown>;
}> {
  const preview = await getTransactionDraftPostingPreviewByName(deps, input);
  const digest = assertConfirmationMatches(input, preview.confirmationSummary, {
    action: "post_transaction_draft_rows_by_name",
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    batchId: (preview._meta as { batchId: string }).batchId,
    batchVersion: (preview._meta as { batchVersion: number }).batchVersion,
    rowNumbers: preview.rowNumbers,
    preview: preview.preview,
  });
  const meta = preview._meta as {
    batchId: string;
    batchVersion: number;
    rowIds: string[];
    rowVersions: Array<{ rowId: string; expectedVersion: number }>;
  };
  const result = await postTransactionDraftRows(deps, {
    batchId: meta.batchId,
    expectedBatchVersion: meta.batchVersion,
    expectedRowVersions: meta.rowVersions,
    rowIds: meta.rowIds,
    idempotencyKey: input.idempotencyKey,
    typedConfirmation: input.typedConfirmation,
  });
  const rowNumbersByRowId = meta.rowIds.reduce<Record<string, number>>((accumulator, rowId, index) => {
    const rowNumber = preview.rowNumbers[index];
    if (rowNumber !== undefined) accumulator[rowId] = rowNumber;
    return accumulator;
  }, {});
  return {
    outcome: result.outcome,
    portfolio: toPortfolioRef(deps),
    batchLabel: preview.batchLabel,
    batchVersion: result.batchVersion,
    postedRowNumbers: result.postedRowIds.map((rowId) => rowNumbersByRowId[rowId]).filter((rowNumber): rowNumber is number => rowNumber !== undefined),
    createdTransactionCount: result.createdTransactionIds.length,
    remainingUnresolvedRowNumbers: result.remainingUnresolvedRowIds
      .map((rowId) => rowNumbersByRowId[rowId])
      .filter((rowNumber): rowNumber is number => rowNumber !== undefined),
    confirmation: result.confirmation,
    rowErrors: result.rowErrors.map((rowError) => ({
      rowNumber: rowNumbersByRowId[rowError.rowId] ?? null,
      state: rowError.state,
      issues: rowError.issues,
    })),
    confirmationSummary: preview.confirmationSummary,
    confirmationDigest: digest,
    _meta: {
      batchId: result.batchId,
      postedRowIds: result.postedRowIds,
      createdTransactionIds: result.createdTransactionIds,
      remainingUnresolvedRowIds: result.remainingUnresolvedRowIds,
      deepLinkUrl: result.deepLinkUrl,
      eventIds: result.eventIds,
      rowErrors: result.rowErrors,
    },
  };
}
