import { z } from "zod";
import { ACCOUNT_DEFAULT_CURRENCIES, MARKET_CODES, type AiConnectorAccessKind, type AiConnectorScope } from "@vakwen/shared-types";

const adviceBoundary =
  "Descriptive portfolio and draft workflow only. Do not use this tool for investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice.";

const genericMcpToolOutputSchema = z.object({}).passthrough();

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const readOnlyToolAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const boundedWriteToolAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const destructiveWriteToolAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const userScopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const accountDefaultCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);

const marketCodeSchema = z.enum(MARKET_CODES);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const importSourceTypeSchema = z.enum(["csv", "image", "pdf"]);

const candidateSourceMetadataSchema = z.object({
  fileId: userScopedIdSchema.nullish(),
  page: z.number().int().positive().nullish(),
  rowRef: z.string().trim().max(200).nullish(),
  cellRefs: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  snippet: z.string().trim().max(500).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
}).strict();

const importProvenanceSchema = z.object({
  sourceType: importSourceTypeSchema,
  files: z.array(z.object({
    fileId: userScopedIdSchema,
    sourceType: importSourceTypeSchema,
    displayName: z.string().trim().max(200).nullish(),
    mediaType: z.string().trim().max(120).nullish(),
    pageCount: z.number().int().positive().nullish().optional(),
    rowCount: z.number().int().positive().nullish().optional(),
    sha256Prefix: z.string().trim().max(32).nullish().optional(),
    snippet: z.string().trim().max(500).nullish().optional(),
  }).strict()).min(1).max(10),
  extractor: z.object({
    provider: z.string().trim().max(120).nullish().optional(),
    model: z.string().trim().max(120).nullish().optional(),
    runId: z.string().trim().max(200).nullish().optional(),
  }).strict().optional(),
  warnings: z.array(z.string().trim().max(200)).max(10).optional(),
}).strict();

export const mcpSharedInputShape = {
  portfolioContextUserId: userScopedIdSchema.optional(),
  reportingCurrency: currencyCodeSchema.optional(),
  locale: z.string().trim().min(2).max(32).optional(),
} as const;

export const mcpDraftCandidateSchema = z.object({
  rowNumber: z.number().int().positive(),
  recordType: z.enum(["trade", "unsupported"]).default("trade"),
  accountId: userScopedIdSchema.optional(),
  accountName: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["BUY", "SELL"]).optional(),
  ticker: z.string().trim().min(1).max(32).optional(),
  marketCode: marketCodeSchema.optional(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().positive().multipleOf(0.01).optional(),
  priceCurrency: currencyCodeSchema.optional(),
  tradeDate: isoDateSchema.optional(),
  tradeTimestamp: isoDateTimeSchema.optional(),
  bookingSequence: z.number().int().positive().optional(),
  isDayTrade: z.boolean().optional(),
  commissionAmount: z.number().int().nonnegative().optional(),
  taxAmount: z.number().int().nonnegative().optional(),
  note: z.string().trim().max(1_000).optional(),
  sourceRowRef: z.string().trim().max(200).optional(),
  sourceSnippet: z.string().trim().max(500).optional(),
  sourceMetadata: candidateSourceMetadataSchema.optional(),
}).strict();

const toolDefinitions = {
  get_portfolio_overview: {
    description: `Return descriptive portfolio overview data with the user's default locale and reporting currency unless overridden. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_holdings: {
    description: `Return holdings, quote state, and freshness for the selected portfolio context. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_performance: {
    description: `Return descriptive performance time series and totals for a validated dashboard range. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      range: z.string().trim().min(1).max(20).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_recent_transactions: {
    description: `Return recent posted transactions with a default 90-day window, up to one year and 500 rows per call. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      fromDate: isoDateSchema.optional(),
      toDate: isoDateSchema.optional(),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().min(0).default(0),
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
      accountIds: z.array(userScopedIdSchema).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_dividends_overview: {
    description: `Return descriptive upcoming and recent dividend information for the selected portfolio context. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_quote_freshness: {
    description: `Return quote freshness diagnostics and latest quote dates without inferring trade execution prices. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_cash_balance_summary: {
    description: `Return cash balance summaries only. This tool must not expose the full cash ledger. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountIds: z.array(userScopedIdSchema).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  search_instruments: {
    description: `Search supported instruments across TW, US, AU, and KR catalogs for descriptive analysis workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      query: z.string().trim().min(1).max(100),
      markets: z.array(marketCodeSchema).max(MARKET_CODES.length).optional(),
      limit: z.number().int().positive().max(100).default(25),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  list_accounts: {
    description: "List active accounts and, optionally, recently deleted accounts available to the current portfolio context.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      includeDeleted: z.boolean().optional(),
    }),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  create_account: {
    description: "Create an account with a seeded default fee profile. Post-create default-currency changes are not supported through MCP.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      name: z.string().trim().min(1).max(80),
      defaultCurrency: accountDefaultCurrencySchema,
      accountType: z.enum(["broker", "bank", "wallet"]),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  update_account: {
    description: "Update active account metadata by id or by a uniquely resolvable active account name. Default currency is immutable over MCP after creation.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema.optional(),
      accountName: z.string().trim().min(1).max(120).optional(),
      name: z.string().trim().min(1).max(80).optional(),
      accountType: z.enum(["broker", "bank", "wallet"]).optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  soft_delete_account: {
    description: "Soft-delete an active account by id or by a uniquely resolvable active account name.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema.optional(),
      accountName: z.string().trim().min(1).max(120).optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  restore_account: {
    description: "Restore a soft-deleted account by id. If its prior name collides with an active account, Vakwen auto-renames it deterministically.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  get_account_manager_component: {
    description: "Return the ChatGPT Apps account manager component state with active and deleted accounts plus MCP tool bindings.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: {
      "openai/outputTemplate": "/connectors/chatgpt/account-manager",
      "openai/widgetAccessible": true,
    },
  },
  get_transaction_draft_template: {
    description: `Return the trade-only draft template and constraints for BUY/SELL candidate rows. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  preflight_transaction_draft_candidates: {
    description: `Validate candidate trade rows deterministically before batch creation. Unsupported non-trade rows are surfaced as audit-only items. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema).min(1).max(200),
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  create_transaction_draft_batch: {
    description: `Create an MCP draft batch after rerunning deterministic server-side preflight. Creation is all-or-nothing. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema).min(1).max(200),
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  list_transaction_draft_batches: {
    description: `List draft batches visible to the connected user in the selected portfolio context. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      status: z.enum(["open", "archived", "deleted"]).optional(),
      limit: z.number().int().positive().max(100).default(50),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  get_transaction_draft_batch: {
    description: `Return one transaction draft batch with rows, unsupported items, and audit events. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  get_transaction_draft_batch_component: {
    description: `Return the ChatGPT Apps component state for one transaction draft batch. The component can refresh, edit, and post only through MCP tools. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: {
      "openai/outputTemplate": "/connectors/chatgpt/transaction-draft",
      "openai/widgetAccessible": true,
    },
  },
  update_transaction_draft_rows: {
    description: `Update draft rows with optimistic concurrency and deterministic preflight. Rejects edits that introduce blocking issues. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rows: z.array(z.object({
        rowId: userScopedIdSchema,
        expectedVersion: z.number().int().positive(),
        patch: mcpDraftCandidateSchema.omit({ rowNumber: true }).partial(),
      })).min(1).max(200),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  exclude_transaction_draft_rows: {
    description: `Exclude draft rows from further confirmation while preserving audit history. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  reinclude_transaction_draft_rows: {
    description: `Reinclude previously excluded draft rows after rerunning deterministic preflight. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  reject_transaction_draft_rows: {
    description: `Reject draft rows so they remain visible as non-confirmable audit history. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  archive_transaction_draft_batch: {
    description: `Archive a draft batch with optimistic batch version checks. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:archive" as const,
    accessKind: "draft_archive" as const,
  },
  delete_unconfirmed_transaction_draft_batch: {
    description: `Delete a never-confirmed draft batch when it contains zero confirmed rows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:delete" as const,
    accessKind: "draft_delete" as const,
  },
  get_transaction_draft_posting_preview: {
    description: "Return a deterministic posting preview for selected ready draft rows, including account names, fee source, gross/net cash impact, and operational warnings.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive().optional(),
      rowIds: z.array(userScopedIdSchema).min(1).max(200).optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  post_transaction_draft_rows: {
    description: `Post selected ready draft rows into the canonical transaction ledger. Requires transaction:write, expected batch and row versions, an idempotency key, and deterministic server-side revalidation. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
      expectedRowVersions: z.array(z.object({
        rowId: userScopedIdSchema,
        expectedVersion: z.number().int().positive(),
      }).strict()).min(1).max(200),
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      idempotencyKey: z.string().trim().min(8).max(200),
      typedConfirmation: z.string().trim().max(100).optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
} as const;

export type McpToolName = keyof typeof toolDefinitions;
export type McpToolDefinition = typeof toolDefinitions[McpToolName];

function getToolAnnotations(name: McpToolName, accessKind: AiConnectorAccessKind): McpToolAnnotations {
  if (accessKind === "read") return readOnlyToolAnnotations;
  if (name === "delete_unconfirmed_transaction_draft_batch" || name === "soft_delete_account") return destructiveWriteToolAnnotations;
  return boundedWriteToolAnnotations;
}

export function getMcpToolDefinition(toolName: McpToolName): McpToolDefinition {
  return toolDefinitions[toolName];
}

export function listMcpToolDefinitions(): Array<{
  name: McpToolName;
  description: string;
  inputSchema: McpToolDefinition["inputSchema"];
  outputSchema: typeof genericMcpToolOutputSchema;
  annotations: McpToolAnnotations;
  scope: AiConnectorScope;
  accessKind: AiConnectorAccessKind;
  _meta?: Record<string, unknown>;
}> {
  return Object.entries(toolDefinitions).map(([name, value]) => ({
    name: name as McpToolName,
    description: value.description,
    inputSchema: value.inputSchema,
    outputSchema: genericMcpToolOutputSchema,
    annotations: getToolAnnotations(name as McpToolName, value.accessKind),
    scope: value.scope,
    accessKind: value.accessKind,
    _meta: "_meta" in value ? value._meta : undefined,
  }));
}

export const ALL_MCP_SCOPES: AiConnectorScope[] = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
];
