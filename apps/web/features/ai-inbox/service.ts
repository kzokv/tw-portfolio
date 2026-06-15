import type {
  AiConnectorAccessLogDto,
  AiConnectorConnectionDto,
  AiConnectorPolicySettingsDto,
  AiConnectorSummaryDto,
  McpOAuthConsentDecisionDto,
  McpOAuthConsentRequestDto,
  ShareCapability,
  TransactionAiInboxBadgeDto,
  TransactionDraftBatchDetailDto,
  TransactionDraftBatchDto,
  TransactionDraftRowDto,
} from "@vakwen/shared-types";
import { deleteJson, getJson, patchJson, postJson } from "../../lib/api";

export type DraftBatchSummary = TransactionDraftBatchDto & { deepLinkUrl: string };
export type DraftRow = TransactionDraftRowDto & {
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  note: string | null;
};
export type DraftBatchDetail = TransactionDraftBatchDetailDto & {
  batch: DraftBatchSummary;
  rows: DraftRow[];
  deepLinkUrl: string;
};

export interface AiConnectorsResponse {
  connections: AiConnectorConnectionDto[];
  accessLogs: AiConnectorAccessLogDto[];
  policy: AiConnectorPolicySettingsDto;
}

export type AiConnectorSummaryResponse = AiConnectorSummaryDto;

export interface AiConnectorLogsResponse {
  accessLogs: AiConnectorAccessLogDto[];
}

export interface DraftRowPatch {
  accountId?: string | null;
  accountName?: string | null;
  type?: "BUY" | "SELL" | null;
  ticker?: string | null;
  marketCode?: "TW" | "US" | "AU" | null;
  quantity?: number | null;
  unitPrice?: number | null;
  priceCurrency?: string | null;
  tradeDate?: string | null;
  tradeTimestamp?: string | null;
  bookingSequence?: number | null;
  isDayTrade?: boolean | null;
  commissionAmount?: number | null;
  taxAmount?: number | null;
  note?: string | null;
  sourceSnippet?: string | null;
}

export async function fetchAiInboxBadge(): Promise<TransactionAiInboxBadgeDto> {
  return getJson<TransactionAiInboxBadgeDto>("/ai/transaction-drafts/badge");
}

export async function fetchDraftBatches(): Promise<DraftBatchSummary[]> {
  const response = await getJson<{ batches: DraftBatchSummary[] }>("/ai/transaction-drafts?status=open&limit=100");
  return response.batches;
}

export async function fetchDraftBatch(batchId: string): Promise<DraftBatchDetail> {
  return getJson<DraftBatchDetail>(`/ai/transaction-drafts/${encodeURIComponent(batchId)}`);
}

export async function updateDraftRow(
  batchId: string,
  rowId: string,
  expectedVersion: number,
  patch: DraftRowPatch,
): Promise<DraftBatchDetail> {
  return patchJson<DraftBatchDetail>(
    `/ai/transaction-drafts/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`,
    { expectedVersion, patch },
  );
}

export async function transitionDraftRows(
  action: "exclude" | "reinclude" | "reject",
  batchId: string,
  rowIds: string[],
  expectedBatchVersion: number,
): Promise<DraftBatchDetail> {
  return postJson<DraftBatchDetail>(
    `/ai/transaction-drafts/${encodeURIComponent(batchId)}/${action}`,
    { rowIds, expectedBatchVersion },
  );
}

export async function archiveDraftBatch(batchId: string, expectedBatchVersion: number): Promise<DraftBatchDetail> {
  return postJson<DraftBatchDetail>(
    `/ai/transaction-drafts/${encodeURIComponent(batchId)}/archive`,
    { expectedBatchVersion },
  );
}

export async function deleteDraftBatch(batchId: string, expectedBatchVersion: number): Promise<{ ok: true }> {
  return deleteJson<{ ok: true }>(
    `/ai/transaction-drafts/${encodeURIComponent(batchId)}`,
    { body: { expectedBatchVersion } },
  );
}

export async function confirmDraftRows(
  batchId: string,
  rows: Array<{ id: string; version: number }>,
  expectedBatchVersion: number,
  typedConfirmation?: string,
): Promise<DraftBatchDetail & { created: unknown[] }> {
  return postJson<DraftBatchDetail & { created: unknown[] }>(
    `/ai/transaction-drafts/${encodeURIComponent(batchId)}/confirm`,
    {
      rowIds: rows.map((row) => row.id),
      expectedRowVersions: rows.map((row) => ({ rowId: row.id, expectedVersion: row.version })),
      expectedBatchVersion,
      idempotencyKey: buildDraftPostIdempotencyKey(batchId),
      typedConfirmation,
    },
  );
}

function buildDraftPostIdempotencyKey(batchId: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `web-ai-draft:${batchId}:${crypto.randomUUID()}`;
  }
  return `web-ai-draft:${batchId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export async function fetchAiConnectors(): Promise<AiConnectorsResponse> {
  return getJson<AiConnectorsResponse>("/ai/connectors");
}

export async function fetchAiConnectorSummary(): Promise<AiConnectorSummaryResponse> {
  return getJson<AiConnectorSummaryResponse>("/ai/connectors/summary");
}

export async function fetchAiConnectorLogs(limit = 12): Promise<AiConnectorLogsResponse> {
  return getJson<AiConnectorLogsResponse>(`/ai/connectors/logs?limit=${encodeURIComponent(String(limit))}`);
}

export async function updateAiConnector(
  id: string,
  patch: {
    scopes?: string[];
    toolToggles?: Record<string, boolean>;
    expiresAt?: string | null;
  },
): Promise<AiConnectorConnectionDto> {
  return patchJson<AiConnectorConnectionDto>(`/ai/connectors/${encodeURIComponent(id)}`, patch);
}

export async function revokeAiConnector(id: string): Promise<AiConnectorConnectionDto> {
  return deleteJson<AiConnectorConnectionDto>(`/ai/connectors/${encodeURIComponent(id)}`);
}

export async function fetchMcpOAuthConsent(requestId: string): Promise<McpOAuthConsentRequestDto> {
  return getJson<McpOAuthConsentRequestDto>(`/oauth/consent/${encodeURIComponent(requestId)}`);
}

export async function approveMcpOAuthConsent(
  requestId: string,
  input: { csrfToken: string; scopes: string[]; lifetimeDays: number },
): Promise<McpOAuthConsentDecisionDto> {
  return postJson<McpOAuthConsentDecisionDto>(
    `/oauth/consent/${encodeURIComponent(requestId)}/approve`,
    input,
  );
}

export async function denyMcpOAuthConsent(
  requestId: string,
  csrfToken: string,
): Promise<McpOAuthConsentDecisionDto> {
  return postJson<McpOAuthConsentDecisionDto>(
    `/oauth/consent/${encodeURIComponent(requestId)}/deny`,
    { csrfToken },
  );
}

export const SHARE_CAPABILITIES: ShareCapability[] = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
];
