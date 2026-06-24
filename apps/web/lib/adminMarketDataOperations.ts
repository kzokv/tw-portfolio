import type {
  AdminMarketCode,
  AdminMarketDataOperationsResponse,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
  ProviderOperationOutcomeSummaryDto,
  ProviderOperationOutcomesResponse,
} from "@vakwen/shared-types";
import type { AdminDictionary } from "../components/admin/admin-i18n";

type RawRecord = Record<string, unknown>;

export interface NormalizedOperationLogEntry {
  id: string;
  occurredAt: string;
  level: string;
  phase?: string | null;
  message: string;
  detail?: string | null;
  context?: Record<string, unknown> | null;
  operationId: string | null;
}

export interface NormalizedOperationSummaryPart {
  kind: string;
  value: string;
}

export interface NormalizedOperationExecuteState {
  canExecute: boolean;
  previewExpired: boolean;
  blockedReason: string | null;
  executeMode: string | null;
  confirmationLevel: string | null;
  confirmationText: string | null;
  acknowledgementLabel: string | null;
  previewToken: string | null;
  endpointDiscriminator: string | null;
}

export interface NormalizedOperationItem {
  id: string;
  providerId: string;
  marketCode: AdminMarketCode;
  operationType: string;
  phase: string;
  matchCount: number;
  progressPercent: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  previewExpiresAt: string | null;
  rawIdLabel: string;
  previewText: string;
  summaryParts: NormalizedOperationSummaryPart[];
  details: RawRecord | null;
  relatedActivitySearch: string;
  debugMetadata: Record<string, unknown> | null;
  sourceSymbol?: string | null;
  resolvedSymbol?: string | null;
  resolverMode?: string | null;
  outcomeSummary: ProviderOperationOutcomeSummaryDto;
  legacy: ProviderFixerDashboardOperationDto | null;
  execution: NormalizedOperationExecuteState;
  controls: {
    canPause: boolean;
    canResume: boolean;
    canCancel: boolean;
    canRetry: boolean;
  };
}

export interface NormalizedOperationPage {
  marketCode: AdminMarketCode;
  providers: Array<{ providerId: string; label: string; role: string }>;
  items: NormalizedOperationItem[];
  total: number;
  page: number;
  limit: number;
  selectedOperation: NormalizedOperationItem | null;
}

function asRecord(value: unknown): RawRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RawRecord;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function friendlyLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function legacyPreviewText(operation: ProviderFixerDashboardOperationDto): string {
  return operation.preview.scopeSummary || operation.preview.scopeLabel || operation.id;
}

const emptyOutcomeSummary: ProviderOperationOutcomeSummaryDto = {
  total: 0,
  processed: 0,
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  rateLimited: 0,
  cancelled: 0,
  progressPercent: 0,
  result: "none",
};

function outcomeSummaryFromRaw(raw: unknown): ProviderOperationOutcomeSummaryDto {
  const record = asRecord(raw);
  if (!record) return emptyOutcomeSummary;
  const result = stringValue(record.result);
  return {
    total: numberValue(record.total) ?? 0,
    processed: numberValue(record.processed) ?? 0,
    pending: numberValue(record.pending) ?? 0,
    running: numberValue(record.running) ?? 0,
    succeeded: numberValue(record.succeeded) ?? 0,
    failed: numberValue(record.failed) ?? 0,
    skipped: numberValue(record.skipped) ?? 0,
    rateLimited: numberValue(record.rateLimited) ?? 0,
    cancelled: numberValue(record.cancelled) ?? 0,
    progressPercent: numberValue(record.progressPercent) ?? 0,
    result:
      result === "running"
      || result === "all_succeeded"
      || result === "partial"
      || result === "none_applied"
      || result === "failed"
      || result === "rate_limited"
      || result === "none"
        ? result
        : "none",
  };
}

function futureSummaryParts(summary: RawRecord | null): NormalizedOperationSummaryPart[] {
  const previewParts = Array.isArray(summary?.previewParts) ? summary.previewParts : [];
  return previewParts.flatMap((item) => {
    const stringPart = stringValue(item);
    if (stringPart) {
      return [{ kind: "text", value: stringPart }];
    }
    const record = asRecord(item);
    const value = stringValue(record?.value);
    if (!record || !value) return [];
    return [{
      kind: stringValue(record.kind) ?? "text",
      value,
    }];
  });
}

export function localizeOperationType(value: string, dict: AdminDictionary["marketData"]): string {
  return dict.operationTypeLabels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function localizeOperationPhase(value: string, dict: AdminDictionary["marketData"]): string {
  return dict.operationPhaseLabels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function localizeOperationOutcomeState(value: string, dict: AdminDictionary["marketData"]): string {
  return dict.operationOutcomeStateLabels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function localizeOperationPreview(
  operation: NormalizedOperationItem,
  dict: AdminDictionary["marketData"],
): string {
  if (operation.summaryParts.length === 0) return operation.previewText;
  return operation.summaryParts.map((part) => {
    if (part.kind === "text") return part.value;
    const label = dict.operationSummaryPartLabels[part.kind] ?? part.kind.replaceAll("_", " ");
    return `${label}: ${part.value}`;
  }).join(" · ");
}

export function localizeOperationOutcomeSummary(
  operation: NormalizedOperationItem,
  dict: AdminDictionary["marketData"],
): string {
  const summary = operation.outcomeSummary;
  const resultLabel = dict.operationOutcomeResultLabels[summary.result] ?? friendlyLabel(summary.result);
  if (summary.total === 0) return resultLabel;
  const parts = [
    `${summary.succeeded.toLocaleString()} ${dict.operationOutcomeSummaryMapped}`,
    `${summary.skipped.toLocaleString()} ${dict.operationOutcomeSummarySkipped}`,
  ];
  if (summary.failed > 0) parts.push(`${summary.failed.toLocaleString()} ${dict.operationOutcomeSummaryFailed}`);
  if (summary.rateLimited > 0) parts.push(`${summary.rateLimited.toLocaleString()} ${dict.operationOutcomeSummaryRateLimited}`);
  if (summary.running > 0 || summary.pending > 0) {
    parts.push(`${(summary.running + summary.pending).toLocaleString()} ${dict.operationOutcomeSummaryPending}`);
  }
  return `${resultLabel} · ${parts.join(" · ")}`;
}

function normalizeLegacyOperation(
  marketCode: AdminMarketCode,
  operation: ProviderFixerDashboardOperationDto,
): NormalizedOperationItem {
  const previewExpired = operation.preview.tokenExpiresAt
    ? new Date(operation.preview.tokenExpiresAt).getTime() <= Date.now()
    : false;
  const metadata: Record<string, unknown> = {
    scopeType: operation.preview.scopeType,
    scopeLabel: operation.preview.scopeLabel,
    queryBacked: operation.preview.queryBacked,
    snapshotHash: operation.preview.snapshotHash,
    sampleCount: operation.preview.sampleCount,
  };
  return {
    id: operation.id,
    providerId: operation.providerId,
    marketCode,
    operationType: "provider_operation",
    phase: operation.phase,
    matchCount: operation.matchCount,
    progressPercent: operation.progressPercent,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    previewExpiresAt: operation.preview.tokenExpiresAt,
    rawIdLabel: operation.id,
    previewText: legacyPreviewText(operation),
    summaryParts: [],
    details: {
      frozenScope: operation.preview.frozenScope,
      evidenceSample: operation.preview.evidenceSample,
      confirmationMode: operation.preview.confirmationMode,
      confirmationText: operation.preview.confirmationText,
    },
    relatedActivitySearch: operation.id,
    debugMetadata: metadata,
    sourceSymbol: stringValue(operation.preview.evidenceSample[0]?.symbol) ?? null,
    resolvedSymbol: stringValue(operation.preview.evidenceSample[0]?.candidateSymbol) ?? null,
    resolverMode: null,
    outcomeSummary: operation.outcomeSummary ?? emptyOutcomeSummary,
    legacy: operation,
    execution: {
      canExecute: operation.canExecute,
      previewExpired,
      blockedReason: previewExpired ? "preview_expired" : null,
      executeMode: "provider_fixer_execute",
      confirmationLevel: operation.preview.confirmationMode,
      confirmationText: operation.preview.confirmationText,
      acknowledgementLabel: operation.preview.acknowledgementLabel,
      previewToken: operation.preview.token,
      endpointDiscriminator: "provider_fixer_execute",
    },
    controls: {
      canPause: operation.canPause,
      canResume: operation.canResume,
      canCancel: operation.canCancel,
      canRetry: operation.canRetry,
    },
  };
}

function normalizeFutureOperation(raw: RawRecord, fallbackMarketCode: AdminMarketCode): NormalizedOperationItem {
  const summary = asRecord(raw.summary);
  const rawDetails = asRecord(raw.details);
  const details = asRecord(rawDetails?.fields) ?? rawDetails;
  const debugMetadata = asRecord(raw.debug) ?? asRecord(raw.debugMetadata);
  const execute = asRecord(raw.execute);
  const previewExpiresAt = stringValue(raw.previewExpiresAt);
  const previewExpired = booleanValue(execute?.previewExpired)
    ?? booleanValue(raw.previewExpired)
    ?? (previewExpiresAt ? new Date(previewExpiresAt).getTime() <= Date.now() : false);
  const operationType = stringValue(raw.operationType) ?? "provider_operation";
  const marketCode = (stringValue(raw.marketCode) ?? fallbackMarketCode) as AdminMarketCode;
  const outcomeSummary = outcomeSummaryFromRaw(asRecord(summary)?.outcomeSummary);
  const previewText = stringValue(raw.previewText)
    ?? futureSummaryParts(summary).map((part) => part.value).join(" · ")
    ?? stringValue(summary?.kind)
    ?? operationType;

  return {
    id: stringValue(raw.id) ?? "unknown-operation",
    providerId: stringValue(raw.providerId) ?? "unknown-provider",
    marketCode,
    operationType,
    phase: stringValue(raw.phase) ?? "unknown",
    matchCount: numberValue(raw.matchCount) ?? 0,
    progressPercent: numberValue(raw.progressPercent),
    createdAt: stringValue(raw.createdAt),
    updatedAt: stringValue(raw.updatedAt),
    startedAt: stringValue(raw.startedAt),
    completedAt: stringValue(raw.completedAt),
    cancelledAt: stringValue(raw.cancelledAt),
    previewExpiresAt,
    rawIdLabel: stringValue(raw.id) ?? "unknown-operation",
    previewText,
    summaryParts: futureSummaryParts(summary),
    details,
    relatedActivitySearch: stringValue(raw.id) ?? "",
    debugMetadata,
    sourceSymbol: stringValue(raw.sourceSymbol) ?? stringValue(details?.sourceSymbol) ?? stringValue(details?.mappingSourceSymbol),
    resolvedSymbol: stringValue(raw.resolvedSymbol) ?? stringValue(details?.resolvedSymbol) ?? stringValue(details?.mappingResolvedSymbol),
    resolverMode: stringValue(raw.resolverMode) ?? stringValue(details?.resolverMode),
    outcomeSummary,
    legacy: null,
    execution: {
      canExecute: booleanValue(execute?.canExecute) ?? false,
      previewExpired,
      blockedReason: stringValue(execute?.blockedReason),
      executeMode: stringValue(execute?.executeMode),
      confirmationLevel: stringValue(execute?.confirmationLevel),
      confirmationText: stringValue(execute?.confirmationText),
      acknowledgementLabel: stringValue(execute?.acknowledgementLabel),
      previewToken: stringValue(execute?.previewToken),
      endpointDiscriminator: stringValue(execute?.endpoint) ?? stringValue(execute?.endpointDiscriminator),
    },
    controls: {
      canPause: booleanValue(raw.canPause) ?? false,
      canResume: booleanValue(raw.canResume) ?? false,
      canCancel: booleanValue(raw.canCancel) ?? false,
      canRetry: booleanValue(raw.canRetry) ?? false,
    },
  };
}

export function normalizeOperationItem(
  marketCode: AdminMarketCode,
  operation: ProviderFixerDashboardOperationDto | RawRecord,
): NormalizedOperationItem {
  if ("preview" in operation) {
    return normalizeLegacyOperation(marketCode, operation as ProviderFixerDashboardOperationDto);
  }
  return normalizeFutureOperation(operation as RawRecord, marketCode);
}

export function normalizeOperationPageResponse(
  input: AdminMarketDataOperationsResponse | ProviderFixerDashboardOperationsResponse | RawRecord,
  marketCode: AdminMarketCode,
  providers: Array<{ providerId: string; label: string; role: string }>,
): NormalizedOperationPage {
  const raw = input as RawRecord;
  const items = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.operations)
      ? raw.operations
      : [];
  const selectedRaw = asRecord(raw.selectedOperation);
  return {
    marketCode,
    providers,
    items: items.map((item) => normalizeOperationItem(marketCode, item as ProviderFixerDashboardOperationDto | RawRecord)),
    total: numberValue(raw.total) ?? items.length,
    page: numberValue(raw.page) ?? 1,
    limit: numberValue(raw.limit) ?? Math.max(items.length, 1),
    selectedOperation: selectedRaw ? normalizeOperationItem(marketCode, selectedRaw) : null,
  };
}

export function operationSupportsOutcomes(
  operation: NormalizedOperationItem,
  outcomes: ProviderOperationOutcomesResponse | null,
): boolean {
  if (outcomes && outcomes.total > 0) return true;
  if (operation.operationType === "provider_operation") return true;
  return operation.operationType.includes("mapping");
}
