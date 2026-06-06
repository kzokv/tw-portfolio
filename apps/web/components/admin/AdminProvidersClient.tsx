"use client";

import { Fragment, type MutableRefObject, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProviderActivityItemDto,
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
  ProviderHealthStatus,
  ProviderHealthStatusDto,
  ProviderIncidentDto,
  ProviderLogPurgePreviewDto,
  ProviderLogPurgePreviewResponse,
  ProviderOperationAction,
  ProviderOperationCapabilityDto,
  ProviderOperationOutcomeDto,
  ProviderOperationOutcomeSummaryDto,
  ProviderResolutionMappingDto,
  ProviderUnresolvedItemDto,
} from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Pagination } from "./Pagination";
import { ApiError, patchJson, postJson } from "../../lib/api";
import { useEventStream } from "../../hooks/useEventStream";
import { cn } from "../../lib/utils";

type ProviderConsoleTab =
  | "overview"
  | "unresolved"
  | "fixer"
  | "operations"
  | "incidents"
  | "activity"
  | "logs"
  | "mappings";

type ProviderUnresolvedSort = "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
type ProviderConsoleDisplayStatus = ProviderHealthStatus | "attention" | "critical_backlog";
type ProviderFixerScopeItem = Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">;
interface ProviderFixerFilterScope {
  providerId: string;
  marketCode: ProviderUnresolvedItemDto["marketCode"] | null;
  errorCode: string;
  state: ProviderUnresolvedItemDto["state"] | null;
  search: string | null;
}
type ProviderFixerRepairScope =
  | {
      type: "selected_items";
      items: ProviderFixerScopeItem[];
    }
  | {
      type: "filter";
      marketCode?: ProviderUnresolvedItemDto["marketCode"];
      errorCode: string;
      state: "active";
      search?: string;
    };

interface ProviderGroup {
  label: string;
  budgetLabel: string;
  providers: ProviderHealthStatusDto[];
}

interface AdminProvidersClientProps {
  providers: ProviderHealthStatusDto[];
  capabilities?: ProviderOperationCapabilityDto[];
  initialProviderId?: string;
  initialTab?: ProviderConsoleTab;
  summary: ProviderFixerDashboardSummaryDto;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
  unresolvedItems: ProviderUnresolvedItemDto[];
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedTotal: number;
  initialUnresolvedState?: ProviderUnresolvedItemDto["state"] | "all";
  initialUnresolvedSearch?: string;
  initialUnresolvedSort?: ProviderUnresolvedSort;
  incidents: ProviderIncidentDto[];
  incidentsPage: number;
  incidentsLimit: number;
  incidentsTotal: number;
  mappings: ProviderResolutionMappingDto[];
  mappingsPage: number;
  mappingsLimit: number;
  mappingsTotal: number;
  activityItems: ProviderActivityItemDto[];
  activityPage: number;
  activityLimit: number;
  activityTotal: number;
  stagedOperation: ProviderFixerDashboardOperationDto | null;
  operations: ProviderFixerDashboardOperationDto[];
  initialOperationId?: string;
  initialRequestedOperationId?: string;
  operationsPage: number;
  operationsLimit: number;
  operationsTotal: number;
  operationOutcomes: ProviderOperationOutcomeDto[];
  operationOutcomeSummary: ProviderOperationOutcomeSummaryDto;
  operationOutcomesPage: number;
  operationOutcomesLimit: number;
  operationOutcomesTotal: number;
  logs: ProviderFixerDashboardLogEntryDto[];
  logsPage: number;
  logsLimit: number;
  logsTotal: number;
  initialMappingsSearch?: string;
  initialOperationOutcomeState?: ProviderOperationOutcomeDto["state"] | "all";
  initialOperationOutcomeAction?: string;
}

const tabLabels: Array<{ id: ProviderConsoleTab; label: string; help: string }> = [
  { id: "overview", label: "Overview", help: "Provider health, unresolved counts, operations, budget pressure, and next recommended actions." },
  { id: "unresolved", label: "Unresolved instruments", help: "Unique unresolved provider rows with filters, selection, disabled-action reasons, and repair candidates." },
  { id: "fixer", label: "Fixer", help: "Provider-scoped Renew, Repair, and Rerun actions with guardrails before writes." },
  { id: "operations", label: "Operations", help: "Provider operation summaries, progress, pause/resume/cancel controls, and durable outcomes." },
  { id: "incidents", label: "Incidents", help: "Durable provider incident lifecycle separate from raw logs." },
  { id: "activity", label: "Activity", help: "Provider-scoped timeline composed from operations, incidents, unresolved rows, and settings changes." },
  { id: "logs", label: "Logs", help: "Raw provider diagnostics with purge guardrails for eligible log sources." },
  { id: "mappings", label: "Mappings", help: "Durable provider-symbol mappings and binding evidence where the provider supports them." },
];

const defaultCapability: ProviderOperationCapabilityDto = {
  providerId: "unknown",
  supportsMappings: false,
  supportsRepair: false,
  supportsRenew: true,
  supportsRerun: false,
  supportsResolverModes: false,
  emptyMappingReason: "This provider does not expose durable mappings yet.",
  actions: [
    { action: "renew_evidence", supported: true, guardrail: "checkbox", reason: null },
    {
      action: "repair_mapping",
      supported: false,
      guardrail: "none",
      reason: "Repair is unavailable because this provider has no mapping resolver.",
    },
    {
      action: "rerun_backfill",
      supported: false,
      guardrail: "none",
      reason: "Rerun is unavailable for this provider or provider plan.",
    },
    {
      action: "reverify_mapping",
      supported: false,
      guardrail: "none",
      reason: "Reverify is unavailable because this provider has no durable mappings.",
    },
    {
      action: "revert_mapping",
      supported: false,
      guardrail: "none",
      reason: "Revert is unavailable because this provider has no durable mappings.",
    },
    { action: "purge_logs", supported: true, guardrail: "typed_preview", reason: null },
    { action: "normalize_errors", supported: true, guardrail: "checkbox", reason: null },
    { action: "refresh_health", supported: true, guardrail: "none", reason: null },
  ],
};
const providerConsoleScrollStorageKey = "vakwen:admin-provider-console-scroll-top";
const operationInspectorFocusStorageKey = "vakwen:admin-provider-console-focus-operation-inspector";

const phaseTone: Record<ProviderFixerDashboardOperationDto["phase"], string> = {
  diagnose: "bg-slate-100 text-slate-700",
  preparing_preview: "bg-indigo-100 text-indigo-800",
  preview: "bg-sky-100 text-sky-700",
  staged: "bg-amber-100 text-amber-800",
  queued: "bg-slate-100 text-slate-800",
  running: "bg-emerald-100 text-emerald-800",
  paused: "bg-orange-100 text-orange-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-200 text-slate-700",
};

const actionHelp = {
  refresh:
    "Reload provider-console state from the API. This does not call the upstream provider or write data.",
  renew:
    "Refresh resolver evidence and candidates. Renew does not write mappings, bars, or resolved data.",
  repair:
    "Create a guarded preview before writing durable provider-symbol mappings for unresolved rows.",
  rerun:
    "Fetch fresh provider data only for rows that are already resolved or durably mapped.",
  purge:
    "Preview eligible raw provider logs before deleting provider_error_trail and provider_operation_logs rows only.",
  markUnsupported:
    "Mark this instrument unsupported for this provider with durable evidence instead of retrying it endlessly.",
  ignore:
    "Hide this unresolved item from active fixer work without marking it resolved or unsupported.",
  reopen:
    "Move this unresolved item back to active so it can be repaired again.",
} as const;

const resolverModeHelp = {
  quote_first:
    "Quote-first checks quote metadata before chart calls. It is the cheaper default and only writes after guarded preview execution.",
  chart_probe_v1:
    "Chart-probe verifies chart/backfill readiness with chart requests. It costs more provider budget and is useful when quote evidence is ambiguous.",
} as const;

const numberFormatter = new Intl.NumberFormat("en-US");
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "numeric",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function csvEscape(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null | undefined>>): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  const link = document.createElement("a");
  link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "Never";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Invalid timestamp";
  return timestampFormatter.format(date);
}

interface UnresolvedScopeSelection {
  type: "selected_items" | "filter";
  count: number;
  label: string;
  filterFingerprint: string;
  selectedItems: ProviderFixerScopeItem[];
  filter: ProviderFixerFilterScope | null;
}

interface ExecuteBlocker {
  label: string;
  satisfied: boolean;
  help: string;
}

function unresolvedItemKey(item: Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">): string {
  return `${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`;
}

function unresolvedScopeFingerprint(args: {
  providerId: string;
  resolverMode: ProviderFixerDashboardDiagnosticsDto["resolverMode"];
  errorCode: string;
  state: ProviderUnresolvedItemDto["state"] | "all";
  search: string;
  sort: ProviderUnresolvedSort;
}): string {
  return JSON.stringify({
    providerId: args.providerId,
    resolverMode: args.resolverMode,
    errorCode: args.errorCode,
    state: args.state,
    search: args.search.trim() || null,
    sort: args.sort,
  });
}

function previewExpired(preview: ProviderFixerDashboardOperationDto["preview"] | null): boolean {
  if (!preview) return true;
  return new Date(preview.tokenExpiresAt).getTime() <= Date.now();
}

function previewMatchesScope(
  preview: ProviderFixerDashboardOperationDto["preview"] | null,
  scope: UnresolvedScopeSelection | null,
): boolean {
  if (!preview || !scope || !preview.frozenScope) return false;
  if (preview.frozenScope.type !== scope.type) return false;
  if (preview.frozenScope.filterFingerprint !== scope.filterFingerprint) return false;
  if (scope.type === "filter") return preview.frozenScope.matchCount === scope.count;
  const previewKeys = preview.frozenScope.selectedItems.map(unresolvedItemKey).sort();
  const scopeKeys = scope.selectedItems.map(unresolvedItemKey).sort();
  return previewKeys.length === scopeKeys.length && previewKeys.every((key, index) => key === scopeKeys[index]);
}

function scopeGuardrailLevel(
  scope: UnresolvedScopeSelection | null,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
): "none" | "checkbox" | "typed_preview" {
  if (!scope || scope.count <= 0) return "none";
  return scope.count >= guardrails.dangerousMatchThreshold ? "typed_preview" : "checkbox";
}

function evidenceString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function mappingEvidenceSummary(evidence: Record<string, unknown> | null): string {
  return evidenceString(evidence?.candidate)
    ?? evidenceString(evidence?.candidateSymbol)
    ?? evidenceString(evidence?.exchangeHint)
    ?? evidenceString(evidence?.note)
    ?? "Stored durable mapping";
}

function mappingLinkedOperation(evidence: Record<string, unknown> | null): string | null {
  return evidenceString(evidence?.operationId)
    ?? evidenceString(evidence?.providerOperationId)
    ?? evidenceString(evidence?.retryOfOperationId);
}

function statusCopy(status: ProviderConsoleDisplayStatus): string {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  if (status === "attention") return "Needs attention";
  if (status === "critical_backlog") return "Critical backlog";
  return "Awaiting action";
}

function statusHelp(status: ProviderConsoleDisplayStatus): string {
  if (status === "healthy") return "Healthy: provider availability checks are passing and no unresolved backlog is above the configured admin thresholds.";
  if (status === "attention") return "Needs attention: provider availability checks are passing, but unresolved instruments are above the configured warning threshold.";
  if (status === "critical_backlog") return "Critical backlog: provider availability checks are passing, but unresolved instruments are above the configured critical threshold.";
  if (status === "degraded") return "Degraded: provider is reachable, but errors, backlog, incidents, or rate limits need attention.";
  if (status === "down") return "Down: provider checks are failing or unavailable; repair work should wait until connectivity recovers.";
  return "Awaiting action: provider is reachable, but a guarded admin decision is required before fixer writes continue.";
}

function statusRank(status: ProviderHealthStatus): number {
  if (status === "down") return 4;
  if (status === "degraded") return 3;
  if (status === "awaiting") return 2;
  return 1;
}

function providerConsoleDisplayStatus(
  status: ProviderHealthStatus,
  unresolvedCount: number,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
): ProviderConsoleDisplayStatus {
  if (status === "down" || status === "awaiting") return status;
  if (unresolvedCount >= guardrails.healthCriticalUnresolvedThreshold) return "critical_backlog";
  if (unresolvedCount >= guardrails.healthWarningUnresolvedThreshold) return "attention";
  return status;
}

function providerGroups(providers: ProviderHealthStatusDto[]): ProviderGroup[] {
  const groupDefs: Array<{ label: string; budgetLabel: string; ids: string[] }> = [
    { label: "KR market data", budgetLabel: "Twelve shared + Yahoo KR budget", ids: ["twelve-data-kr", "yahoo-finance-kr"] },
    { label: "TW market data", budgetLabel: "FinMind shared budget", ids: ["finmind-tw"] },
    { label: "US market data", budgetLabel: "FinMind shared budget", ids: ["finmind-us"] },
    { label: "AU market data", budgetLabel: "Twelve/Yahoo/CSV budgets", ids: ["twelve-data-au", "yahoo-finance-au", "asx-gics-csv"] },
    { label: "FX", budgetLabel: "Internal pacing", ids: ["frankfurter"] },
  ];
  const byId = new Map(providers.map((provider) => [provider.providerId, provider]));
  const seen = new Set<string>();
  const groups = groupDefs.map((group) => {
    const rows = group.ids.map((id) => byId.get(id)).filter((row): row is ProviderHealthStatusDto => !!row);
    rows.forEach((row) => seen.add(row.providerId));
    return { label: group.label, budgetLabel: group.budgetLabel, providers: rows };
  });
  const other = providers.filter((provider) => !seen.has(provider.providerId));
  if (other.length > 0) groups.push({ label: "Other providers", budgetLabel: "Provider-specific", providers: other });
  return groups.filter((group) => group.providers.length > 0);
}

function pickInitialProvider(providers: ProviderHealthStatusDto[]): string {
  return [...providers].sort((a, b) => {
    const statusDelta = statusRank(b.status) - statusRank(a.status);
    if (statusDelta !== 0) return statusDelta;
    return (b.errorCount24h + b.errorCount7d + b.rateLimitCount24h) - (a.errorCount24h + a.errorCount7d + a.rateLimitCount24h);
  })[0]?.providerId ?? "yahoo-finance-kr";
}

function StatusBadge({ status, providerId }: { status: ProviderConsoleDisplayStatus; providerId: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "healthy" && "bg-emerald-100 text-emerald-800",
        status === "degraded" && "bg-amber-100 text-amber-800",
        status === "attention" && "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
        status === "critical_backlog" && "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
        status === "down" && "bg-rose-100 text-rose-800",
        status === "awaiting" && "bg-violet-100 text-violet-800 ring-1 ring-violet-200",
      )}
      data-testid={`provider-status-badge-${providerId}`}
      title={statusHelp(status)}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "healthy" && "bg-emerald-500",
          status === "degraded" && "bg-amber-500",
          status === "attention" && "bg-amber-500",
          status === "critical_backlog" && "bg-orange-500",
          status === "down" && "bg-rose-500",
          status === "awaiting" && "bg-violet-500",
        )}
        aria-hidden="true"
      />
      {statusCopy(status)}
    </span>
  );
}

function operationProgress(operation: ProviderFixerDashboardOperationDto | null): number {
  if (!operation) return 0;
  return operation.progressPercent ?? (operation.phase === "completed" ? 100 : 0);
}

function operationPreviewSummary(operation: ProviderFixerDashboardOperationDto): string {
  return `${formatNumber(operation.preview.sampleCount)} sample / ${formatNumber(operation.preview.matchCount)} matching`;
}

function actionDisabledReason(
  capability: ProviderOperationCapabilityDto,
  action: ProviderOperationAction,
  fallback: string,
): string | null {
  const actionCapability = capability.actions.find((item) => item.action === action);
  if (actionCapability?.supported) return null;
  return actionCapability?.reason ?? fallback;
}

function actionSupported(capability: ProviderOperationCapabilityDto, action: ProviderOperationAction): boolean {
  return capability.actions.find((item) => item.action === action)?.supported ?? false;
}

export function AdminProvidersClient({
  providers,
  capabilities = [],
  initialProviderId,
  initialTab,
  summary,
  guardrails,
  diagnostics,
  unresolvedItems,
  unresolvedPage,
  unresolvedLimit,
  unresolvedTotal,
  initialUnresolvedState = "active",
  initialUnresolvedSearch = "",
  initialUnresolvedSort = "last_seen_desc",
  incidents,
  incidentsPage,
  incidentsLimit,
  incidentsTotal,
  mappings,
  mappingsPage,
  mappingsLimit,
  mappingsTotal,
  activityItems,
  activityPage,
  activityLimit,
  activityTotal,
  stagedOperation,
  operations,
  initialOperationId,
  initialRequestedOperationId,
  operationsPage,
  operationsLimit,
  operationsTotal,
  operationOutcomes,
  operationOutcomeSummary,
  operationOutcomesPage,
  operationOutcomesLimit,
  operationOutcomesTotal,
  logs,
  logsPage,
  logsLimit,
  logsTotal,
  initialMappingsSearch = "",
  initialOperationOutcomeState = "all",
  initialOperationOutcomeAction = "",
}: AdminProvidersClientProps) {
  const router = useRouter();
  const groups = useMemo(() => providerGroups(providers), [providers]);
  const [selectedProviderId, setSelectedProviderId] = useState(() => (
    providers.some((provider) => provider.providerId === initialProviderId) ? initialProviderId! : pickInitialProvider(providers)
  ));
  const [activeTab, setActiveTab] = useState<ProviderConsoleTab>(() =>
    initialTab ?? (summary.criticalUnresolvedCount > 0 ? "unresolved" : "overview"),
  );
  const [selectedOperationId, setSelectedOperationId] = useState(initialOperationId ?? stagedOperation?.id ?? operations[0]?.id ?? "");
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [logPurgePreview, setLogPurgePreview] = useState<ProviderLogPurgePreviewDto | null>(null);
  const [logPurgeConfirmation, setLogPurgeConfirmation] = useState("");
  const [selectedUnresolvedKeys, setSelectedUnresolvedKeys] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [isRoutePending, startRouteTransition] = useTransition();
  const pendingScrollTopRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const providerRequestedOperationId = initialRequestedOperationId ?? initialOperationId ?? "";

  const selectedProvider = providers.find((provider) => provider.providerId === selectedProviderId) ?? providers[0] ?? null;
  const capability =
    capabilities.find((item) => item.providerId === selectedProviderId)
    ?? { ...defaultCapability, providerId: selectedProviderId };
  const renewDisabledReason = actionDisabledReason(capability, "renew_evidence", "Renew is unavailable for this provider.");
  const repairDisabledReason = actionDisabledReason(
    capability,
    "repair_mapping",
    "Repair is unavailable because this provider has no mapping resolver.",
  );
  const rerunProviderDisabledReason = actionDisabledReason(
    capability,
    "rerun_backfill",
    "Rerun is unavailable for this provider or provider plan.",
  );
  const rerunDisabledReason = rerunProviderDisabledReason ?? "Rerun requires resolved items or durable provider mappings.";
  const providerDiagnostics = diagnostics.rows.filter((row) => row.providerId === selectedProviderId);
  const fallbackDiagnosis = providerDiagnostics[0] ?? diagnostics.rows[0] ?? null;
  const activeErrorCode = fallbackDiagnosis?.errorCode ?? diagnostics.errorCode;
  const selectedDisplayStatus = selectedProvider
    ? providerConsoleDisplayStatus(selectedProvider.status, fallbackDiagnosis?.unresolvedCount ?? 0, guardrails)
    : null;
  const providerUnresolvedItems = unresolvedItems.filter((item) => item.providerId === selectedProviderId);
  const unresolvedFingerprint = useMemo(() => unresolvedScopeFingerprint({
    providerId: selectedProviderId,
    resolverMode: diagnostics.resolverMode,
    errorCode: activeErrorCode,
    state: initialUnresolvedState,
    search: initialUnresolvedSearch,
    sort: initialUnresolvedSort,
  }), [
    activeErrorCode,
    diagnostics.resolverMode,
    initialUnresolvedSearch,
    initialUnresolvedSort,
    initialUnresolvedState,
    selectedProviderId,
  ]);
  const providerOperations = operations.filter((operation) => operation.providerId === selectedProviderId);
  const providerStagedOperation = stagedOperation?.providerId === selectedProviderId ? stagedOperation : null;
  const selectedOperationFromList =
    providerOperations.find((operation) => operation.id === selectedOperationId)
    ?? (providerStagedOperation?.id === selectedOperationId ? providerStagedOperation : null);
  const requestedOperationMissing = selectedOperationId.length > 0 && !selectedOperationFromList;
  const selectedOperation =
    selectedOperationFromList
    ?? (selectedOperationId.length === 0 ? providerStagedOperation ?? providerOperations[0] ?? null : null)
    ?? null;
  const progressOperation =
    providerOperations.find((operation) => operation.phase === "running")
    ?? providerOperations.find((operation) => operation.phase === "preparing_preview")
    ?? providerOperations.find((operation) => operation.phase === "paused")
    ?? providerOperations.find((operation) => operation.phase === "queued")
    ?? selectedOperation;
  const currentPreview = selectedOperation?.preview ?? null;
  const outcomeActionFilter = initialOperationOutcomeAction.trim().toLowerCase();
  const visibleOperationOutcomes = useMemo(
    () => operationOutcomes
      .filter((outcome) => outcome.providerId === selectedProviderId)
      .filter((outcome) => outcomeActionFilter.length === 0 || outcome.action.toLowerCase().includes(outcomeActionFilter)),
    [operationOutcomes, outcomeActionFilter, selectedProviderId],
  );
  const selectedScope = useMemo<UnresolvedScopeSelection | null>(() => {
    if (allMatchingSelected) {
      return {
        type: "filter",
        count: unresolvedTotal,
        label: "All matching unresolved rows",
        filterFingerprint: unresolvedFingerprint,
        selectedItems: [],
        filter: {
          providerId: selectedProviderId,
          marketCode: providerUnresolvedItems[0]?.marketCode ?? "KR",
          errorCode: activeErrorCode,
          state: "active",
          search: initialUnresolvedSearch.trim() || null,
        },
      };
    }

    const selectedItems = providerUnresolvedItems.filter((item) => selectedUnresolvedKeys.has(unresolvedItemKey(item)));
    if (selectedItems.length === 0) return null;

    return {
      type: "selected_items",
      count: selectedItems.length,
      label: selectedItems.length === 1 ? "1 selected unresolved row" : `${formatNumber(selectedItems.length)} selected unresolved rows`,
      filterFingerprint: unresolvedFingerprint,
      selectedItems: selectedItems.map((item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
      })),
      filter: null,
    };
  }, [
    activeErrorCode,
    allMatchingSelected,
    initialUnresolvedSearch,
    providerUnresolvedItems,
    selectedProviderId,
    selectedUnresolvedKeys,
    unresolvedFingerprint,
    unresolvedTotal,
  ]);
  const typedConfirmationRequired = currentPreview?.confirmationMode === "typed";
  const currentPreviewExpired = previewExpired(currentPreview);
  const scopeMatchesPreview = previewMatchesScope(currentPreview, selectedScope);
  const executeBlockers: ExecuteBlocker[] = [
    {
      label: "Token still valid",
      satisfied: !currentPreviewExpired,
      help: "Preview tokens expire. Refresh the scoped preview after expiry.",
    },
    {
      label: "Operation selected",
      satisfied: !!selectedOperation,
      help: "Choose a staged operation before executing.",
    },
    {
      label: "Scope selected",
      satisfied: !!selectedScope,
      help: "Pick visible rows or explicitly choose all matching before previewing repair.",
    },
    {
      label: "Scope matches preview",
      satisfied: scopeMatchesPreview,
      help: "Selection or filters changed after the preview was created. Create a fresh preview.",
    },
    {
      label: "Operation executable",
      satisfied: !!selectedOperation?.canExecute,
      help: "Legacy, expired, queued, or running operations cannot execute.",
    },
    {
      label: "Checkbox acknowledged",
      satisfied: confirmationChecked,
      help: "The execution acknowledgement checkbox must be checked.",
    },
    {
      label: "Typed phrase matches",
      satisfied: !typedConfirmationRequired || typedConfirmation.trim() === currentPreview?.confirmationText,
      help: "Dangerous previews require the exact typed phrase.",
    },
  ];
  const executeDisabled =
    busyAction !== null
    || !selectedScope
    || !scopeMatchesPreview
    || currentPreviewExpired
    || !selectedOperation?.canExecute
    || !confirmationChecked
    || (typedConfirmationRequired && typedConfirmation.trim() !== currentPreview?.confirmationText);

  useEffect(() => {
    if (selectedProvider && selectedProvider.providerId === selectedProviderId) return;
    setSelectedProviderId(pickInitialProvider(providers));
  }, [providers, selectedProvider, selectedProviderId]);

  useEffect(() => {
    if (!initialProviderId || !providers.some((provider) => provider.providerId === initialProviderId)) return;
    setSelectedProviderId((current) => current === initialProviderId ? current : initialProviderId);
  }, [initialProviderId, providers]);

  useEffect(() => {
    if (!initialTab) return;
    setActiveTab((current) => current === initialTab ? current : initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!providerRequestedOperationId) return;
    setSelectedOperationId((current) => current === providerRequestedOperationId ? current : providerRequestedOperationId);
  }, [providerRequestedOperationId]);

  useEffect(() => {
    if (selectedOperationId.length > 0) return;
    setSelectedOperationId(providerStagedOperation?.id ?? providerOperations[0]?.id ?? "");
  }, [providerOperations, providerStagedOperation, selectedOperationId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const storedTop = window.sessionStorage.getItem(providerConsoleScrollStorageKey);
    if (!storedTop) return;
    const top = Number.parseInt(storedTop, 10);
    if (!Number.isFinite(top) || top <= 0) {
      window.sessionStorage.removeItem(providerConsoleScrollStorageKey);
      return;
    }
    scheduleScrollRestore(top);
  }, []);

  useEffect(() => {
    setSelectedUnresolvedKeys(new Set());
    setAllMatchingSelected(false);
    setConfirmationChecked(false);
    setTypedConfirmation("");
  }, [unresolvedFingerprint]);

  useEffect(() => {
    if (pendingScrollTopRef.current == null) return;
    const top = pendingScrollTopRef.current;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: "auto" });
    });
  }, [activityItems, incidents, logs, mappings, operationOutcomes, operations, unresolvedItems]);

  useEffect(() => () => {
    if (refreshTimeoutRef.current !== null) window.clearTimeout(refreshTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (activeTab !== "operations") return;
    if (!selectedOperation) return;
    if (typeof window === "undefined") return;
    const pendingFocusId = window.sessionStorage.getItem(operationInspectorFocusStorageKey);
    if (pendingFocusId !== selectedOperation.id) return;
    window.sessionStorage.removeItem(operationInspectorFocusStorageKey);
    window.requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      inspectorRef.current?.focus();
    });
  }, [activeTab, selectedOperation]);

  useEventStream({
    eventTypes: [
      "provider_operation_progress",
      "provider_operation_phase_changed",
      "provider_unresolved_item_changed",
      "provider_incident_changed",
      "provider_budget_wait_changed",
    ],
    onEvent: () => {
      if (refreshTimeoutRef.current !== null) window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        refreshPreservingScroll();
      }, 250);
    },
    enabled: true,
  });

  function currentRouteParams(): URLSearchParams {
    return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  }

  function scheduleScrollRestore(top = typeof window === "undefined" ? 0 : window.scrollY): void {
    pendingScrollTopRef.current = top;
    if (top > 0) window.sessionStorage.setItem(providerConsoleScrollStorageKey, String(top));
    const restore = () => {
      if (pendingScrollTopRef.current !== top) return;
      const currentTop = window.scrollY;
      if (currentTop > 0 && Math.abs(currentTop - top) > 24) {
        pendingScrollTopRef.current = null;
        return;
      }
      window.scrollTo({ top, behavior: "auto" });
    };
    window.requestAnimationFrame(restore);
    for (const delay of [0, 150, 500, 1000, 2000, 3500, 5000]) {
      window.setTimeout(restore, delay);
    }
    const intervalId = window.setInterval(restore, 250);
    window.setTimeout(() => {
      window.clearInterval(intervalId);
      if (pendingScrollTopRef.current === top) pendingScrollTopRef.current = null;
      if (window.sessionStorage.getItem(providerConsoleScrollStorageKey) === String(top)) {
        window.sessionStorage.removeItem(providerConsoleScrollStorageKey);
      }
    }, 6000);
  }

  function refreshPreservingScroll(): void {
    scheduleScrollRestore();
    router.refresh();
  }

  function pushProviderRoute(params: URLSearchParams): void {
    startRouteTransition(() => {
      router.push(`/admin/providers?${params.toString()}`, { scroll: false });
    });
  }

  function pushProviderRouteMutating(
    mutate: (params: URLSearchParams) => void,
    options?: { preserveScroll?: boolean },
  ): void {
    const params = currentRouteParams();
    mutate(params);
    if (options?.preserveScroll ?? true) scheduleScrollRestore();
    pushProviderRoute(params);
  }

  function selectTab(tab: ProviderConsoleTab): void {
    setActiveTab(tab);
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", tab);
      params.set("resolverMode", diagnostics.resolverMode);
      params.set("errorCode", fallbackDiagnosis?.errorCode ?? diagnostics.errorCode);
      if (tab !== "operations") {
        params.delete("operationId");
        params.delete("operationOutcomesPage");
        params.delete("operationOutcomeState");
        params.delete("operationOutcomeAction");
      }
    });
  }

  function selectProvider(providerId: string): void {
    const row = diagnostics.rows.find((item) => item.providerId === providerId);
    const nextTab: ProviderConsoleTab = row && row.unresolvedCount > 0 ? "unresolved" : activeTab;
    setSelectedProviderId(providerId);
    setSelectedOperationId("");
    setConfirmationChecked(false);
    setTypedConfirmation("");
    setLogPurgePreview(null);
    setLogPurgeConfirmation("");
    setActiveTab(nextTab);
    pushProviderRouteMutating((params) => {
      params.set("providerId", providerId);
      params.set("tab", nextTab);
      params.set("resolverMode", diagnostics.resolverMode);
      params.set("errorCode", row?.errorCode ?? diagnostics.errorCode);
      params.delete("operationId");
      params.delete("operationOutcomesPage");
      params.delete("logsPage");
    });
  }

  function refreshData(): void {
    setToast({ title: "Refreshing provider data", body: "Reloading console state from the API. No upstream provider calls are made." });
    refreshPreservingScroll();
    window.setTimeout(() => setToast({ title: "Refresh complete", body: "Provider console data was refreshed from local API state." }), 500);
  }

  async function runAction<T>(
    actionName: string,
    action: () => Promise<T>,
    options?: {
      onSuccess?: (result: T) => void;
      refreshOnSuccess?: boolean;
      successToast?: { title: string; body: string } | null;
    },
  ): Promise<void> {
    setBusyAction(actionName);
    setActionError(null);
    try {
      const result = await action();
      options?.onSuccess?.(result);
      if (options?.successToast) {
        setToast(options.successToast);
      } else {
        setToast({ title: "Provider operation updated", body: "The operation state changed. Refreshing console data." });
      }
      if (options?.refreshOnSuccess ?? true) refreshPreservingScroll();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Provider operation failed.";
      setActionError(message);
      setToast({ title: "Provider operation failed", body: message });
    } finally {
      setBusyAction(null);
    }
  }

  function toggleUnresolvedRow(item: ProviderUnresolvedItemDto): void {
    setAllMatchingSelected(false);
    setSelectedUnresolvedKeys((current) => {
      const next = new Set(current);
      const key = unresolvedItemKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setVisibleUnresolvedRows(items: ProviderUnresolvedItemDto[], checked: boolean): void {
    setAllMatchingSelected(false);
    setSelectedUnresolvedKeys((current) => {
      const next = new Set(current);
      for (const item of items) {
        const key = unresolvedItemKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function clearUnresolvedSelection(): void {
    setAllMatchingSelected(false);
    setSelectedUnresolvedKeys(new Set());
  }

  function selectAllMatchingScope(): void {
    setSelectedUnresolvedKeys(new Set());
    setAllMatchingSelected(true);
  }

  function focusRowScope(item: ProviderUnresolvedItemDto, destination: ProviderConsoleTab = "fixer"): void {
    setSelectedUnresolvedKeys(new Set([unresolvedItemKey(item)]));
    setAllMatchingSelected(false);
    setConfirmationChecked(false);
    setTypedConfirmation("");
    if (destination !== activeTab) setActiveTab(destination);
  }

  function toRepairScope(scope: UnresolvedScopeSelection | null): ProviderFixerRepairScope | undefined {
    if (!scope) return undefined;
    if (scope.type === "filter" && scope.filter) {
      return {
        type: "filter",
        ...(scope.filter.marketCode ? { marketCode: scope.filter.marketCode } : {}),
        errorCode: scope.filter.errorCode,
        state: "active",
        ...(scope.filter.search ? { search: scope.filter.search } : {}),
      };
    }
    return {
      type: "selected_items",
      items: scope.selectedItems,
    };
  }

  function previewRepair(scope?: ProviderFixerRepairScope): void {
    const row = fallbackDiagnosis;
    const effectiveScope = scope ?? toRepairScope(selectedScope);
    if (!row || !effectiveScope) {
      setToast({
        title: "Repair scope required",
        body: "Select unresolved rows or explicitly choose all matching before creating a repair preview.",
      });
      setActiveTab("fixer");
      return;
    }
    void runAction("preview", () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/preview`, {
        resolverMode: diagnostics.resolverMode,
        errorCode: row.errorCode,
        scope: effectiveScope,
      }),
      {
        onSuccess: (result) => {
          setSelectedOperationId(result.operation.id);
          setConfirmationChecked(false);
          setTypedConfirmation("");
          setActiveTab("fixer");
        },
      },
    );
  }

  function bulkUpdateUnresolvedState(state: "unsupported" | "ignored"): void {
    const scope = toRepairScope(selectedScope);
    if (!scope || !selectedScope) {
      setToast({ title: "Bulk scope required", body: "Select rows or choose all matching before changing unresolved state." });
      return;
    }
    const phrase = state === "unsupported"
      ? selectedScope.type === "filter"
        ? `MARK ${selectedScope.count} MATCHING UNSUPPORTED`
        : `MARK ${selectedScope.count} UNSUPPORTED`
      : selectedScope.type === "filter"
        ? `IGNORE ${selectedScope.count} MATCHING ACTIVE`
        : `IGNORE ${selectedScope.count} ACTIVE`;
    const dangerous = selectedScope.type === "filter" || selectedScope.count >= guardrails.dangerousMatchThreshold;
    let typedConfirmation: string | undefined;
    if (dangerous) {
      typedConfirmation = window.prompt(`Type ${phrase} to ${state === "unsupported" ? "mark unsupported" : "ignore"} this scope.`)?.trim();
      if (typedConfirmation !== phrase) {
        setToast({ title: "Confirmation phrase mismatch", body: `Bulk ${state} requires the exact phrase ${phrase}.` });
        return;
      }
    } else if (!window.confirm(`Apply ${state} to ${selectedScope.count} selected unresolved row${selectedScope.count === 1 ? "" : "s"}?`)) {
      return;
    }
    void runAction(`bulk-unresolved:${state}`, () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(selectedProviderId)}/unresolved/state/bulk`, {
        scope,
        state,
        acknowledged: !dangerous,
        typedConfirmation,
      }),
      {
        onSuccess: (result) => {
          setSelectedOperationId(result.operation.id);
          clearUnresolvedSelection();
          setActiveTab("operations");
        },
      },
    );
  }

  function renewEvidence(scope?: ProviderFixerRepairScope): void {
    const row = fallbackDiagnosis;
    void runAction("renew", () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/renew`, {
        resolverMode: diagnostics.resolverMode,
        errorCode: row?.errorCode ?? diagnostics.errorCode,
        ...(scope ? { scope } : {}),
      }),
      {
        onSuccess: (result) => {
          if (!result.operation?.id) return;
          setSelectedOperationId(result.operation.id);
        },
        successToast: {
          title: "Operation created",
          body: "Renew created a provider operation. Open Operations to inspect progress.",
        },
      },
    );
  }

  function executeSelectedOperation(): void {
    if (!selectedOperation || !currentPreview) return;
    void runAction("execute", () =>
      postJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/${encodeURIComponent(selectedOperation.id)}/execute`, {
        previewToken: currentPreview.token,
        acknowledged: confirmationChecked,
        typedConfirmation: typedConfirmation.trim(),
      }),
      {
        onSuccess: () => {
          selectOperation(selectedOperation.id, { focusInspector: true, announce: false });
        },
        refreshOnSuccess: false,
        successToast: {
          title: "Repair started",
          body: `Inspecting ${selectedOperation.id} in Operations while the provider operation runs.`,
        },
      },
    );
  }

  function mutateOperation(operationId: string, action: "pause" | "resume" | "cancel" | "retry"): void {
    void runAction(action, () =>
      postJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/${encodeURIComponent(operationId)}/${action}`, {}),
    );
  }

  function updateIncidentStatus(incidentId: string, status: ProviderIncidentDto["status"]): void {
    void runAction(`incident:${status}:${incidentId}`, () =>
      patchJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/incidents/${encodeURIComponent(incidentId)}`, { status }),
    );
  }

  function updateUnresolvedItemState(item: ProviderUnresolvedItemDto, state: "active" | "unsupported" | "ignored"): void {
    void runAction(`unresolved:${state}:${item.sourceSymbol}`, () =>
      postJson(`/admin/providers/${encodeURIComponent(item.providerId)}/unresolved/state`, {
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        state,
      }),
    );
  }

  function reverifyMapping(mapping: ProviderResolutionMappingDto): void {
    void runAction(`mapping:reverify:${mapping.sourceSymbol}`, () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(mapping.providerId)}/mappings/reverify`, {
        marketCode: mapping.marketCode,
        sourceSymbol: mapping.sourceSymbol,
        resolverMode: mapping.resolverMode ?? diagnostics.resolverMode,
      }),
      {
        onSuccess: (result: { operation: ProviderFixerDashboardOperationDto }) => {
          if (!result.operation?.id) return;
          setSelectedOperationId(result.operation.id);
        },
        successToast: {
          title: "Reverify started",
          body: `Created a provider operation for ${mapping.sourceSymbol}. Use Inspect in Operations to review it.`,
        },
      },
    );
  }

  function revertMapping(mapping: ProviderResolutionMappingDto, typedConfirmation: string): void {
    void runAction(`mapping:revert:${mapping.sourceSymbol}`, () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(mapping.providerId)}/mappings/revert`, {
        marketCode: mapping.marketCode,
        sourceSymbol: mapping.sourceSymbol,
        typedConfirmation,
      }),
      {
        onSuccess: (result: { operation: ProviderFixerDashboardOperationDto }) => {
          if (!result.operation?.id) return;
          setSelectedOperationId(result.operation.id);
        },
        successToast: {
          title: "Revert started",
          body: `Created a provider operation for ${mapping.sourceSymbol}. Use Inspect in Operations to review it.`,
        },
      },
    );
  }

  function rerunMapping(mapping: ProviderResolutionMappingDto): void {
    void runAction(`mapping:rerun:${mapping.sourceSymbol}`, () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(mapping.providerId)}/mappings/rerun`, {
        marketCode: mapping.marketCode,
        sourceSymbol: mapping.sourceSymbol,
        resolverMode: mapping.resolverMode ?? diagnostics.resolverMode,
        acknowledged: true,
      }),
      {
        onSuccess: (result: { operation: ProviderFixerDashboardOperationDto }) => {
          if (!result.operation?.id) return;
          setSelectedOperationId(result.operation.id);
        },
        successToast: {
          title: "Rerun queued",
          body: `Created a provider operation for ${mapping.sourceSymbol}. Use Inspect in Operations to review it.`,
        },
      },
    );
  }

  function rerunUnresolvedItem(item: ProviderUnresolvedItemDto): void {
    void runAction(`unresolved:rerun:${item.sourceSymbol}`, () =>
      postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(item.providerId)}/mappings/rerun`, {
        marketCode: item.marketCode,
        sourceSymbol: item.sourceSymbol,
        resolverMode: diagnostics.resolverMode,
        acknowledged: true,
      }),
      {
        onSuccess: (result: { operation: ProviderFixerDashboardOperationDto }) => {
          if (!result.operation?.id) return;
          setSelectedOperationId(result.operation.id);
        },
        successToast: {
          title: "Rerun queued",
          body: `Created a provider operation for ${item.sourceSymbol}. Use Inspect in Operations to review it.`,
        },
      },
    );
  }

  function openMappingUnresolved(mapping: ProviderResolutionMappingDto): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", mapping.providerId);
      params.set("tab", "unresolved");
      params.set("resolverMode", diagnostics.resolverMode);
      params.set("errorCode", diagnostics.errorCode);
      params.set("unresolvedState", "all");
      params.set("unresolvedSearch", mapping.sourceSymbol);
      params.set("unresolvedPage", "1");
    });
  }

  function openMappingOperation(mapping: ProviderResolutionMappingDto): void {
    const operationId = mappingLinkedOperation(mapping.evidence);
    if (!operationId) return;
    setSelectedOperationId(operationId);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(operationInspectorFocusStorageKey, operationId);
    }
    pushProviderRouteMutating((params) => {
      params.set("providerId", mapping.providerId);
      params.set("tab", "operations");
      params.set("resolverMode", diagnostics.resolverMode);
      params.set("errorCode", diagnostics.errorCode);
      params.set("operationId", operationId);
      params.set("operationOutcomesPage", "1");
    });
  }

  function applyUnresolvedFilters(next: {
    state?: ProviderUnresolvedItemDto["state"] | "all";
    search?: string;
    sort?: ProviderUnresolvedSort;
    page?: number;
  }): void {
    setActiveTab("unresolved");
    setToast({ title: "Applying unresolved filters", body: "Refreshing provider rows for the selected filter." });
    const search = next.search ?? initialUnresolvedSearch;
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "unresolved");
      params.set("resolverMode", diagnostics.resolverMode);
      params.set("errorCode", fallbackDiagnosis?.errorCode ?? diagnostics.errorCode);
      params.set("unresolvedState", next.state ?? initialUnresolvedState);
      params.set("unresolvedSort", next.sort ?? initialUnresolvedSort);
      params.set("unresolvedPage", String(next.page ?? 1));
      if (search.trim()) params.set("unresolvedSearch", search.trim());
      else params.delete("unresolvedSearch");
    });
  }

  function selectOperation(operationId: string, options?: { focusInspector?: boolean; announce?: boolean }): void {
    setSelectedOperationId(operationId);
    if (options?.focusInspector !== false && typeof window !== "undefined") {
      window.sessionStorage.setItem(operationInspectorFocusStorageKey, operationId);
    }
    if (options?.announce) {
      setToast({ title: "Operation selected", body: `Inspecting ${operationId} below the history table.` });
    }
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "operations");
      params.set("operationId", operationId);
      params.set("operationOutcomesPage", "1");
    });
  }

  function applyOperationsPage(page: number): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "operations");
      params.set("operationsPage", String(page));
      if (selectedOperationId) params.set("operationId", selectedOperationId);
    });
  }

  function applyIncidentsPage(page: number): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "incidents");
      params.set("incidentsPage", String(page));
    });
  }

  function applyActivityPage(page: number): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "activity");
      params.set("activityPage", String(page));
    });
  }

  function applyLogsPage(page: number): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "logs");
      params.set("logsPage", String(page));
      if (selectedOperationId) params.set("operationId", selectedOperationId);
    });
  }

  function applyMappingsPage(page: number): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "mappings");
      params.set("mappingsPage", String(page));
      const search = (params.get("mappingsSearch") ?? initialMappingsSearch).trim();
      if (search.length > 0) params.set("mappingsSearch", search);
      else params.delete("mappingsSearch");
    });
  }

  function applyMappingsSearch(search: string): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "mappings");
      params.set("mappingsPage", "1");
      if (search.trim()) params.set("mappingsSearch", search.trim());
      else params.delete("mappingsSearch");
    });
  }

  function applyOperationOutcomeFilters(next: {
    page?: number;
    state?: ProviderOperationOutcomeDto["state"] | "all";
    action?: string;
  }): void {
    pushProviderRouteMutating((params) => {
      params.set("providerId", selectedProviderId);
      params.set("tab", "operations");
      if (selectedOperationId) params.set("operationId", selectedOperationId);
      params.set("operationOutcomesPage", String(next.page ?? 1));
      const state = next.state ?? initialOperationOutcomeState;
      if (state === "all") params.delete("operationOutcomeState");
      else params.set("operationOutcomeState", state);
      const action = next.action ?? initialOperationOutcomeAction;
      if (action.trim()) params.set("operationOutcomeAction", action.trim());
      else params.delete("operationOutcomeAction");
    });
  }

  function previewLogPurge(): void {
    void runAction("purge-preview", async () => {
      const result = await postJson<ProviderLogPurgePreviewResponse>(
        `/admin/providers/${encodeURIComponent(selectedProviderId)}/logs/purge/preview`,
        {},
      );
      setLogPurgePreview(result.preview);
      setLogPurgeConfirmation("");
    });
  }

  function executeLogPurge(): void {
    if (!logPurgePreview) return;
    void runAction("purge-execute", async () => {
      await postJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/logs/purge/execute`, {
        operationId: logPurgePreview.operationId,
        previewToken: logPurgePreview.previewToken,
        typedConfirmation: logPurgeConfirmation,
      });
      setLogPurgePreview(null);
      setLogPurgeConfirmation("");
    });
  }

  const operationColumns: DataTableColumn<ProviderFixerDashboardOperationDto>[] = [
    { key: "operation", header: "Operation", render: (row) => <span className="font-mono text-xs">{row.id}</span> },
    {
      key: "phase",
      header: "Phase",
      render: (row) => (
        <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", phaseTone[row.phase])}>
          {row.phase}
        </span>
      ),
    },
    { key: "match", header: "Scope", render: (row) => formatNumber(row.matchCount) },
    { key: "preview", header: "Preview", render: operationPreviewSummary },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedOperation?.id === row.id ? "default" : "secondary"}
            onClick={() => selectOperation(row.id, { focusInspector: true, announce: true })}
            data-testid={`provider-console-operation-select-${row.id}`}
          >
            Inspect
          </Button>
          {row.canPause ? <Button size="sm" variant="ghost" onClick={() => mutateOperation(row.id, "pause")}>Pause</Button> : null}
          {row.canResume ? <Button size="sm" variant="ghost" onClick={() => mutateOperation(row.id, "resume")}>Resume</Button> : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!row.canRetry || busyAction !== null}
            title={
              row.canRetry
                ? "Create a fresh preview linked to this operation with a new token and unchanged historical outcomes."
                : "Retry is available after an operation is paused, failed, cancelled, or completed."
            }
            onClick={() => mutateOperation(row.id, "retry")}
            data-testid={`provider-console-operation-retry-${row.id}`}
          >
            Retry
          </Button>
          {row.canCancel ? (
            <Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => mutateOperation(row.id, "cancel")}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const evidenceColumns: DataTableColumn<NonNullable<typeof currentPreview>["evidenceSample"][number]>[] = [
    { key: "symbol", header: "Source symbol", render: (row) => <span className="font-mono">{row.symbol}</span> },
    { key: "providerSymbol", header: "Provider symbol", render: (row) => <span className="font-mono">{row.providerSymbol}</span> },
    { key: "candidate", header: "Candidate", render: (row) => <span className="font-mono">{row.candidateSymbol ?? "-"}</span> },
    { key: "evidence", header: "Evidence", render: (row) => row.exchangeHint ?? "-" },
    { key: "verification", header: "Verification", render: (row) => row.verificationStatus },
    { key: "note", header: "Note", render: (row) => row.note },
  ];

  return (
    <div className="grid w-full max-w-full gap-4 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="provider-console-page">
      <aside className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4" data-testid="provider-console-rail">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Provider console</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Grouped by market domain and shared budget.</p>
        </div>
        {groups.map((group) => (
          <section key={group.label} className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="min-w-0 truncate">{group.label}</span>
              <span className="min-w-0 rounded-full bg-muted px-2 py-1 normal-case tracking-normal">{group.budgetLabel}</span>
            </div>
            {group.providers.map((provider) => {
              const diagnosis = diagnostics.rows.find((row) => row.providerId === provider.providerId);
              const displayStatus = providerConsoleDisplayStatus(provider.status, diagnosis?.unresolvedCount ?? 0, guardrails);
              const activeOperationCount = operations.filter((operation) =>
                operation.providerId === provider.providerId && ["preparing_preview", "preview", "staged", "queued", "running", "paused"].includes(operation.phase)
              ).length;
              return (
                <button
                  key={provider.providerId}
                  type="button"
                  onClick={() => selectProvider(provider.providerId)}
                  title={`${provider.providerId}: ${statusCopy(displayStatus)}. ${diagnosis?.unresolvedCount ?? provider.errorCount7d} unresolved, ${activeOperationCount} active operations.`}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition",
                    provider.providerId === selectedProviderId
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-transparent hover:border-border hover:bg-muted/40",
                  )}
                  data-testid={`provider-console-tab-${provider.providerId}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-all font-semibold text-foreground">{provider.providerId}</span>
                    <StatusBadge status={displayStatus} providerId={provider.providerId} />
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{formatNumber(diagnosis?.unresolvedCount ?? provider.errorCount7d)} unresolved</span>
                    <span>{activeOperationCount} ops</span>
                    <span>{provider.rateLimitCount24h} rate limits</span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </aside>

      <main className="min-w-0 max-w-full space-y-4">
        <Card className="px-4 py-4 hover:translate-y-0 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">
                Admin / Provider console / {selectedProviderId}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl" data-testid="provider-console-title">
                {selectedProviderId}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Provider-owned health, unresolved instruments, fixer actions, operations, activity, logs, and mappings.
              </p>
              <label className="mt-3 grid gap-1 text-sm text-muted-foreground lg:hidden">
                <span>Provider</span>
                <select
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  value={selectedProviderId}
                  onChange={(event) => selectProvider(event.target.value)}
                  data-testid="provider-console-mobile-provider-select"
                >
                  {providers.map((provider) => (
                    <option key={provider.providerId} value={provider.providerId}>
                      {provider.providerId} - {statusCopy(providerConsoleDisplayStatus(
                        provider.status,
                        diagnostics.rows.find((row) => row.providerId === provider.providerId)?.unresolvedCount ?? 0,
                        guardrails,
                      ))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <Button variant="secondary" onClick={refreshData} data-testid="provider-console-refresh" title={actionHelp.refresh}>
                Refresh data
              </Button>
              <Button variant="secondary" disabled={!capability.supportsRenew} onClick={() => renewEvidence()} title={renewDisabledReason ?? actionHelp.renew}>
                Renew evidence
              </Button>
            </div>
          </div>

          <nav className="mt-5 flex max-w-full gap-1 overflow-x-auto border-b border-border" aria-label="Provider console tabs">
            {tabLabels.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => selectTab(tab.id)}
                title={tab.help}
                data-testid={`provider-console-subtab-${tab.id}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </Card>

        {activeTab === "overview" ? (
            <OverviewTab
              selectedProviderId={selectedProviderId}
              displayStatus={selectedDisplayStatus}
              diagnosis={fallbackDiagnosis}
            summary={summary}
            guardrails={guardrails}
            capability={capability}
            onViewUnresolved={() => setActiveTab("unresolved")}
          />
        ) : null}

        {activeTab === "unresolved" ? (
          <UnresolvedTab
            selectedProviderId={selectedProviderId}
            diagnosis={fallbackDiagnosis}
            unresolvedItems={unresolvedItems.filter((item) => item.providerId === selectedProviderId)}
            unresolvedPage={unresolvedPage}
            unresolvedLimit={unresolvedLimit}
            unresolvedTotal={unresolvedTotal}
            initialState={initialUnresolvedState}
            initialSearch={initialUnresolvedSearch}
            initialSort={initialUnresolvedSort}
            selectedScope={selectedScope}
            selectedKeys={selectedUnresolvedKeys}
            allMatchingSelected={allMatchingSelected}
            currentPreview={currentPreview}
            guardrails={guardrails}
            resolverMode={diagnostics.resolverMode}
            capability={capability}
            renewDisabledReason={renewDisabledReason}
            repairDisabledReason={repairDisabledReason}
            rerunDisabledReason={rerunDisabledReason}
            onPreviewRepair={previewRepair}
            onRenewItem={(item) => {
              focusRowScope(item);
              void runAction("renew-row", () =>
                postJson<{ operation: ProviderFixerDashboardOperationDto }>(`/admin/providers/${encodeURIComponent(item.providerId)}/operations/renew`, {
                  marketCode: item.marketCode,
                  resolverMode: diagnostics.resolverMode,
                  errorCode: item.errorCode,
                  scope: {
                    type: "selected_items",
                    items: [{
                      providerId: item.providerId,
                      marketCode: item.marketCode,
                      errorCode: item.errorCode,
                      sourceSymbol: item.sourceSymbol,
                    }],
                  },
                }),
                {
                  onSuccess: (result) => setSelectedOperationId(result.operation.id),
                  successToast: {
                    title: "Renew started",
                    body: `Created a provider operation for ${item.sourceSymbol}. Use Inspect in Operations to review it.`,
                  },
                },
              );
            }}
            onToggleItem={toggleUnresolvedRow}
            onToggleVisiblePage={setVisibleUnresolvedRows}
            onSelectAllMatching={selectAllMatchingScope}
            onClearSelection={clearUnresolvedSelection}
            onFocusRowScope={focusRowScope}
            onSetState={updateUnresolvedItemState}
            onBulkSetState={bulkUpdateUnresolvedState}
            onRenewScope={renewEvidence}
            onRerunItem={rerunUnresolvedItem}
            onApplyFilters={applyUnresolvedFilters}
            busyAction={busyAction}
            routePending={isRoutePending}
          />
        ) : null}

        {activeTab === "fixer" ? (
          <FixerTab
            selectedProviderId={selectedProviderId}
            diagnostics={diagnostics}
            diagnosis={fallbackDiagnosis}
            guardrails={guardrails}
            capability={capability}
            renewDisabledReason={renewDisabledReason}
            repairDisabledReason={repairDisabledReason}
            rerunDisabledReason={rerunDisabledReason}
            selectedScope={selectedScope}
            currentPreview={currentPreview}
            selectedOperation={selectedOperation}
            confirmationChecked={confirmationChecked}
            typedConfirmation={typedConfirmation}
            typedConfirmationRequired={typedConfirmationRequired}
            executeDisabled={executeDisabled}
            executeBlockers={executeBlockers}
            busyAction={busyAction}
            actionError={actionError}
            setConfirmationChecked={setConfirmationChecked}
            setTypedConfirmation={setTypedConfirmation}
            onRenewEvidence={renewEvidence}
            onPreviewRepair={previewRepair}
            onUseAllMatchingScope={selectAllMatchingScope}
            onOpenUnresolvedScope={() => selectTab("unresolved")}
            onExecute={executeSelectedOperation}
            onControlOperation={(action) => {
              if (!selectedOperation) return;
              mutateOperation(selectedOperation.id, action);
            }}
          />
        ) : null}

        {activeTab === "operations" ? (
          <OperationsTab
            operations={providerOperations.length > 0 ? providerOperations : operations}
            operationColumns={operationColumns}
            selectedOperation={selectedOperation}
            requestedOperationMissing={requestedOperationMissing}
            requestedOperationId={providerRequestedOperationId}
            selectedProviderId={selectedProviderId}
            initialOutcomeState={initialOperationOutcomeState}
            initialOutcomeAction={initialOperationOutcomeAction}
            inspectorRef={inspectorRef}
            onOpenLogs={(operationId) => pushProviderRouteMutating((params) => {
              params.set("providerId", selectedProviderId);
              params.set("tab", "logs");
              params.set("operationId", operationId);
              params.set("logsPage", "1");
            })}
            onOpenIncidents={() => pushProviderRouteMutating((params) => {
              params.set("providerId", selectedProviderId);
              params.set("tab", "incidents");
            })}
            onOpenUnresolved={() => pushProviderRouteMutating((params) => {
              params.set("providerId", selectedProviderId);
              params.set("tab", "unresolved");
              params.set("unresolvedState", "active");
            })}
            onPageChange={applyOperationsPage}
            progressOperation={progressOperation}
            selectedScope={selectedScope}
            outcomes={visibleOperationOutcomes}
            outcomeSummary={operationOutcomeSummary}
            outcomesPage={operationOutcomesPage}
            outcomesLimit={operationOutcomesLimit}
            outcomesTotal={operationOutcomesTotal}
            onOutcomeRouteChange={applyOperationOutcomeFilters}
            onInspectOperation={(operationId) => selectOperation(operationId, { focusInspector: true, announce: true })}
            page={operationsPage}
            limit={operationsLimit}
            total={operationsTotal}
          />
        ) : null}

        {activeTab === "incidents" ? (
          <IncidentsTab
            selectedProviderId={selectedProviderId}
            incidents={incidents.filter((incident) => incident.providerId === selectedProviderId)}
            page={incidentsPage}
            limit={incidentsLimit}
            total={incidentsTotal}
            onPageChange={applyIncidentsPage}
            onSetStatus={updateIncidentStatus}
            busyAction={busyAction}
          />
        ) : null}

        {activeTab === "activity" ? (
          <ActivityTab
            selectedProviderId={selectedProviderId}
            items={activityItems.filter((item) => item.providerId === selectedProviderId)}
            page={activityPage}
            limit={activityLimit}
            total={activityTotal}
            onPageChange={applyActivityPage}
          />
        ) : null}

        {activeTab === "logs" ? (
          <LogsTab
            logs={logs}
            page={logsPage}
            limit={logsLimit}
            total={logsTotal}
            selectedProviderId={selectedProviderId}
            purgePreview={logPurgePreview?.providerId === selectedProviderId ? logPurgePreview : null}
            purgeConfirmation={logPurgeConfirmation}
            onPurgeConfirmationChange={setLogPurgeConfirmation}
            onPreviewPurge={previewLogPurge}
            onExecutePurge={executeLogPurge}
            busyAction={busyAction}
            onPageChange={applyLogsPage}
          />
        ) : null}

        {activeTab === "mappings" ? (
          <MappingsTab
            selectedProviderId={selectedProviderId}
            capability={capability}
            mappings={mappings.filter((mapping) => mapping.providerId === selectedProviderId)}
            page={mappingsPage}
            limit={mappingsLimit}
            total={mappingsTotal}
            search={initialMappingsSearch}
            currentPreview={currentPreview}
            evidenceColumns={evidenceColumns}
            onReverifyMapping={reverifyMapping}
            onRevertMapping={revertMapping}
            onRerunMapping={rerunMapping}
            onOpenUnresolvedMapping={openMappingUnresolved}
            onOpenMappingOperation={openMappingOperation}
            onPageChange={applyMappingsPage}
            onSearchChange={applyMappingsSearch}
            busyAction={busyAction}
          />
        ) : null}
      </main>

      {toast ? (
        <div
          className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-primary shadow-lg"
          data-testid="provider-console-toast"
        >
          <p className="font-semibold">{toast.title}</p>
          <p className="mt-1 text-primary/80">{toast.body}</p>
        </div>
      ) : null}
    </div>
  );
}

function OverviewTab({
  selectedProviderId,
  displayStatus,
  diagnosis,
  summary,
  guardrails,
  capability,
  onViewUnresolved,
}: {
  selectedProviderId: string;
  displayStatus: ProviderConsoleDisplayStatus | null;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  summary: ProviderFixerDashboardSummaryDto;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  capability: ProviderOperationCapabilityDto;
  onViewUnresolved: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Console status" value={displayStatus ? statusCopy(displayStatus) : "Unknown"} detail="Availability plus configured unresolved backlog thresholds." />
          <Metric label="Active unresolved" value={formatNumber(diagnosis?.unresolvedCount ?? 0)} detail="From provider console diagnostics until durable unresolved rows are fully migrated." />
          <Metric label="Operations" value={formatNumber(summary.activeOperationsCount)} detail={`${formatNumber(summary.runningOperationsCount)} running, ${formatNumber(summary.queuedOperationsCount)} queued.`} />
        </div>
        <Card className="space-y-3 px-4 py-4 hover:translate-y-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Why this status?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Console status separates provider availability from unresolved instrument backlog so healthy upstream checks can still surface admin work.
              </p>
            </div>
            <Button variant="secondary" onClick={onViewUnresolved}>View unresolved</Button>
          </div>
          <Reason
            tone={(diagnosis?.unresolvedCount ?? 0) >= guardrails.healthCriticalUnresolvedThreshold ? "danger" : "warning"}
            title="Unresolved backlog"
            body={`${formatNumber(diagnosis?.unresolvedCount ?? 0)} active rows are visible for ${selectedProviderId}; warning starts at ${formatNumber(guardrails.healthWarningUnresolvedThreshold)} and critical starts at ${formatNumber(guardrails.healthCriticalUnresolvedThreshold)}.`}
          />
          <Reason tone="info" title="Guardrails active" body={`Bulk writes at or above ${formatNumber(guardrails.dangerousMatchThreshold)} matches require typed confirmation.`} />
          <Reason tone="info" title="Provider capability" body={capability.supportsMappings ? "Durable mappings are supported for this provider." : capability.emptyMappingReason} />
        </Card>
      </section>
      <aside className="space-y-4">
        <Card className="px-4 py-4 hover:translate-y-0">
          <h3 className="text-lg font-semibold text-foreground">Effective operation settings</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <SettingReadout label="Small write threshold" value={`${formatNumber(guardrails.dangerousMatchThreshold)} items`} />
            <SettingReadout label="Preview sample" value={`${formatNumber(guardrails.previewSampleLimit)} rows`} />
            <SettingReadout label="Page size" value={`${formatNumber(guardrails.uiPageSize)} rows`} />
            <SettingReadout label="Preview TTL" value={`${formatNumber(guardrails.previewTokenTtlSeconds / 60)} min`} />
          </dl>
        </Card>
        <Card className="px-4 py-4 hover:translate-y-0">
          <h3 className="text-lg font-semibold text-foreground">Action help</h3>
          <HelpList />
        </Card>
      </aside>
    </div>
  );
}

function UnresolvedTab({
  selectedProviderId,
  diagnosis,
  unresolvedItems,
  unresolvedPage,
  unresolvedLimit,
  unresolvedTotal,
  initialState,
  initialSearch,
  initialSort,
  selectedScope,
  selectedKeys,
  allMatchingSelected,
  currentPreview,
  guardrails,
  resolverMode,
  capability,
  renewDisabledReason,
  repairDisabledReason,
  rerunDisabledReason,
  onPreviewRepair,
  onRenewItem,
  onToggleItem,
  onToggleVisiblePage,
  onSelectAllMatching,
  onClearSelection,
  onFocusRowScope,
  onSetState,
  onBulkSetState,
  onRenewScope,
  onRerunItem,
  onApplyFilters,
  busyAction,
  routePending,
}: {
  selectedProviderId: string;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  unresolvedItems: ProviderUnresolvedItemDto[];
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedTotal: number;
  initialState: ProviderUnresolvedItemDto["state"] | "all";
  initialSearch: string;
  initialSort: ProviderUnresolvedSort;
  selectedScope: UnresolvedScopeSelection | null;
  selectedKeys: Set<string>;
  allMatchingSelected: boolean;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  resolverMode: ProviderFixerDashboardDiagnosticsDto["resolverMode"];
  capability: ProviderOperationCapabilityDto;
  renewDisabledReason: string | null;
  repairDisabledReason: string | null;
  rerunDisabledReason: string;
  onPreviewRepair: (scope?: ProviderFixerRepairScope) => void;
  onRenewItem: (item: ProviderUnresolvedItemDto) => void;
  onToggleItem: (item: ProviderUnresolvedItemDto) => void;
  onToggleVisiblePage: (items: ProviderUnresolvedItemDto[], checked: boolean) => void;
  onSelectAllMatching: () => void;
  onClearSelection: () => void;
  onFocusRowScope: (item: ProviderUnresolvedItemDto, destination?: ProviderConsoleTab) => void;
  onSetState: (item: ProviderUnresolvedItemDto, state: "active" | "unsupported" | "ignored") => void;
  onBulkSetState: (state: "unsupported" | "ignored") => void;
  onRenewScope: (scope?: ProviderFixerRepairScope) => void;
  onRerunItem: (item: ProviderUnresolvedItemDto) => void;
  onApplyFilters: (next: { state?: ProviderUnresolvedItemDto["state"] | "all"; search?: string; sort?: ProviderUnresolvedSort; page?: number }) => void;
  busyAction: string | null;
  routePending: boolean;
}) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [stateInput, setStateInput] = useState<ProviderUnresolvedItemDto["state"] | "all">(initialState);
  const [sortInput, setSortInput] = useState<ProviderUnresolvedSort>(initialSort);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLSelectElement>(null);
  const sortInputRef = useRef<HTMLSelectElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setStateInput(initialState);
  }, [initialState]);

  useEffect(() => {
    setSortInput(initialSort);
  }, [initialSort]);

  const readCurrentFilters = () => {
    const stateValue = stateInputRef.current?.value;
    const sortValue = sortInputRef.current?.value;
    return {
      search: searchInputRef.current?.value ?? searchInput,
      state: stateValue === "resolved" || stateValue === "unsupported" || stateValue === "ignored" || stateValue === "active" || stateValue === "all"
        ? stateValue
        : stateInput,
      sort: sortValue === "updated_desc" || sortValue === "source_symbol_asc" || sortValue === "occurrence_count_desc" || sortValue === "last_seen_desc"
        ? sortValue
        : sortInput,
    };
  };

  const applyCurrentFilters = (page = 1) => {
    onApplyFilters({ ...readCurrentFilters(), page });
  };

  const evidence = currentPreview?.evidenceSample ?? [];
  const rows = unresolvedItems.length > 0
    ? unresolvedItems.map((item) => ({
        key: unresolvedItemKey(item),
        item,
        sourceSymbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol ?? item.sourceSymbol,
        candidateSymbol: null as string | null,
        state: item.state,
        stateLabel: item.state,
        evidence: `${item.occurrenceCount} occurrences; last seen ${formatTimestamp(item.lastSeenAt)}`,
        note: item.errorCode,
      }))
    : evidence.map((item) => ({
        key: `${selectedProviderId}-${item.symbol}-${item.providerSymbol}`,
        item: null,
        sourceSymbol: item.symbol,
        providerSymbol: item.providerSymbol,
        candidateSymbol: item.candidateSymbol,
        state: "active",
        stateLabel: item.verificationStatus === "verified" ? "candidate found" : item.verificationStatus,
        evidence: item.exchangeHint ?? item.note,
        note: item.note,
      }));
  const visibleDurableRows = rows.filter((row): row is (typeof rows)[number] & { item: ProviderUnresolvedItemDto } => row.item !== null);
  const visibleDurableKeys = visibleDurableRows.map((row) => row.key);
  const selectedVisibleCount = visibleDurableKeys.filter((key) => selectedKeys.has(key)).length;
  const allVisibleSelected = visibleDurableKeys.length > 0 && selectedVisibleCount === visibleDurableKeys.length;
  const selectedCount = selectedScope?.count ?? 0;
  const canRepairSelected = initialState === "active" && capability.supportsRepair && selectedCount > 0 && busyAction === null;
  const canRenewSelected = capability.supportsRenew && selectedCount > 0 && busyAction === null;
  const matchingErrorCode = diagnosis?.errorCode ?? visibleDurableRows[0]?.item.errorCode ?? "symbol_unresolved";
  const renewScopeBlockedReason = selectedScope
    ? renewDisabledReason ?? actionHelp.renew
    : "Select a concrete scope before using renew from Unresolved instruments.";

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisibleCount]);

  const toggleVisibleSelection = (checked: boolean) => {
    onToggleVisiblePage(visibleDurableRows.map((row) => row.item), checked);
  };

  const toggleRowSelection = (key: string, checked: boolean) => {
    const row = visibleDurableRows.find((item) => item.key === key)?.item;
    if (!row) return;
    const isSelected = selectedKeys.has(key);
    if (checked === isSelected) return;
    onToggleItem(row);
  };

  const previewSelectedScope = () => {
    if (!canRepairSelected) return;
    if (allMatchingSelected) {
      onPreviewRepair({
        type: "filter",
        marketCode: visibleDurableRows[0]?.item.marketCode,
        errorCode: matchingErrorCode,
        state: "active",
        search: searchInput.trim() || undefined,
      });
      return;
    }
    if (!selectedScope || selectedScope.type !== "selected_items") return;
    onPreviewRepair({ type: "selected_items", items: selectedScope.selectedItems });
  };
  const renewSelectedScope = () => {
    if (!canRenewSelected) return;
    if (allMatchingSelected) {
      onRenewScope({
        type: "filter",
        marketCode: visibleDurableRows[0]?.item.marketCode,
        errorCode: matchingErrorCode,
        state: "active",
        search: searchInput.trim() || undefined,
      });
      return;
    }
    if (!selectedScope || selectedScope.type !== "selected_items") return;
    onRenewScope({ type: "selected_items", items: selectedScope.selectedItems });
  };
  const canMarkUnsupported = actionSupported(capability, "mark_unsupported");
  const canIgnore = actionSupported(capability, "ignore_unresolved");
  const canReopen = actionSupported(capability, "reopen_unresolved");
  const canRerun = actionSupported(capability, "rerun_backfill");
  const lifecycleUnavailable = "Available for durable unresolved rows only.";
  const linkedContextSearch = initialState === "all" && initialSearch.trim().length > 0;
  const linkedContextHasDurableRow = visibleDurableRows.length > 0;
  const linkedContextHasActiveRow = visibleDurableRows.some((row) => row.item.state === "active");
  const rowRerunTitle = (row: (typeof rows)[number]) => {
    if (!canRerun) return rerunDisabledReason;
    if (!row.item || row.item.state !== "resolved") return "Rerun is disabled until this durable row is resolved or mapped.";
    return "Rerun creates a provider operation that enqueues a fresh backfill for this resolved row.";
  };
  const rowRerunDisabled = (row: (typeof rows)[number]) => !canRerun || !row.item || row.item.state !== "resolved" || busyAction !== null;
  const exportRows = selectedScope?.type === "selected_items"
    ? visibleDurableRows.filter((row) => selectedKeys.has(row.key))
    : visibleDurableRows;
  const exportTitle = selectedScope?.type === "filter"
    ? "Export the currently loaded page as a sample of the all-matching scope. Use pagination to export more rows."
    : selectedScope?.type === "selected_items"
      ? "Export the selected rows visible on this page."
      : "Export the currently loaded filtered rows for offline review.";
  const exportLoadedRows = () => {
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    downloadCsv(`${selectedProviderId}-unresolved-${timestamp}.csv`, exportRows.map((row) => ({
      providerId: row.item.providerId,
      marketCode: row.item.marketCode,
      errorCode: row.item.errorCode,
      sourceSymbol: row.item.sourceSymbol,
      providerSymbol: row.item.providerSymbol,
      state: row.item.state,
      occurrenceCount: row.item.occurrenceCount,
      firstSeenAt: row.item.firstSeenAt,
      lastSeenAt: row.item.lastSeenAt,
      lastErrorTrailId: row.item.lastErrorTrailId,
      resolvedAt: row.item.resolvedAt,
      resolvedByOperationId: row.item.resolvedByOperationId,
      updatedAt: row.item.updatedAt,
    })));
  };
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Unique unresolved instruments</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider-scoped durable unresolved rows. Preview evidence appears only when no durable rows are available for this provider.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={exportRows.length === 0} onClick={exportLoadedRows} title={exportTitle} data-testid="provider-console-export-unresolved">Export</Button>
          <Button disabled={!canRepairSelected} onClick={previewSelectedScope} title={canRepairSelected ? actionHelp.repair : "Select at least one durable active unresolved row before previewing repair."}>Repair selected</Button>
        </div>
      </div>
      <form
        className="flex flex-col gap-2 xl:flex-row xl:flex-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          applyCurrentFilters();
        }}
      >
        <input
          ref={searchInputRef}
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground xl:min-w-[220px] xl:flex-1"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search symbol, provider symbol, error"
          data-testid="provider-console-unresolved-search"
        />
        <select
          ref={stateInputRef}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground xl:w-40"
          value={stateInput}
          onChange={(event) => setStateInput(event.target.value as ProviderUnresolvedItemDto["state"] | "all")}
          data-testid="provider-console-unresolved-state"
        >
          <option value="active">State: active</option>
          <option value="all">State: all</option>
          <option value="resolved">State: resolved</option>
          <option value="unsupported">State: unsupported</option>
          <option value="ignored">State: ignored</option>
        </select>
        <select
          ref={sortInputRef}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground xl:w-48"
          value={sortInput}
          onChange={(event) => setSortInput(event.target.value as ProviderUnresolvedSort)}
          data-testid="provider-console-unresolved-sort"
        >
          <option value="last_seen_desc">Sort: last seen</option>
          <option value="updated_desc">Sort: recently updated</option>
          <option value="occurrence_count_desc">Sort: most occurrences</option>
          <option value="source_symbol_asc">Sort: source symbol</option>
        </select>
        <div className="min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm xl:w-56" title={diagnosis?.errorCode ?? "all"}>
          <span className="block truncate">Error: {diagnosis?.errorCode ?? "all"}</span>
        </div>
        <Button type="submit" variant="secondary" disabled={routePending} data-testid="provider-console-unresolved-apply">
          {routePending ? "Applying..." : "Apply filters"}
        </Button>
      </form>
      {linkedContextSearch && !linkedContextHasActiveRow ? (
        <Reason
          tone="info"
          title={linkedContextHasDurableRow ? "Linked context has no active unresolved row" : "No unresolved row found for this linked context"}
          body={linkedContextHasDurableRow
            ? "This mapping link is showing all lifecycle states for the searched source symbol because no active unresolved row exists in the current result set."
            : "No durable unresolved row exists for this searched source symbol. The mapping may have been created directly from repair evidence or the item may already be outside unresolved tracking."}
        />
      ) : null}
      <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 sm:flex-row sm:items-center sm:justify-between" data-testid="provider-console-selection-banner">
        <span>
          <strong>{formatNumber(selectedCount)} rows selected.</strong>{" "}
          {selectedScope?.type === "filter"
            ? `All matching rows in the current filter are selected for guarded bulk repair. ${formatNumber(unresolvedTotal || diagnosis?.unresolvedCount || 0)} rows match this filter.`
            : selectedCount > 0
              ? "Visible-page row selection is active."
              : `Select visible rows or choose all matching. ${formatNumber(unresolvedTotal || diagnosis?.unresolvedCount || 0)} rows match this filter.`}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={initialState !== "active" || visibleDurableRows.length === 0}
            onClick={() => {
              if (allMatchingSelected) onClearSelection();
              else onSelectAllMatching();
            }}
            title={initialState === "active" ? "Select every active unresolved row matching this provider/filter, including pages not visible." : "All-matching repair is available only for active unresolved rows."}
            data-testid="provider-console-select-all-matching"
          >
            {allMatchingSelected ? "Clear all matching" : "Select all matching"}
          </Button>
          <Button size="sm" variant="secondary" disabled={!canRepairSelected} onClick={previewSelectedScope} title={canRepairSelected ? actionHelp.repair : "Select at least one durable active unresolved row before previewing repair."}>Repair</Button>
          <Button size="sm" variant="secondary" disabled={!canRenewSelected} onClick={renewSelectedScope} title={renewScopeBlockedReason} data-testid="provider-console-bulk-renew">Renew</Button>
          <Button size="sm" variant="secondary" disabled={!selectedScope || !canIgnore || busyAction !== null} onClick={() => onBulkSetState("ignored")} title={selectedScope ? actionHelp.ignore : "Select a concrete scope before bulk ignore."} data-testid="provider-console-bulk-ignore">Ignore</Button>
          <Button size="sm" variant="secondary" disabled={!selectedScope || !canMarkUnsupported || busyAction !== null} onClick={() => onBulkSetState("unsupported")} title={selectedScope ? actionHelp.markUnsupported : "Select a concrete scope before bulk unsupported."} data-testid="provider-console-bulk-unsupported">Unsupported</Button>
          <Button size="sm" variant="secondary" disabled={exportRows.length === 0} onClick={exportLoadedRows} title={exportTitle} data-testid="provider-console-bulk-export">Export</Button>
          <Button size="sm" variant="secondary" disabled={selectedCount === 0} onClick={onClearSelection}>Clear selection</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setStateInput("resolved");
              setSortInput("updated_desc");
              onClearSelection();
              onApplyFilters({ state: "resolved", search: searchInput, sort: "updated_desc", page: 1 });
            }}
            data-testid="provider-console-recently-resolved"
          >
            Recently resolved
          </Button>
        </div>
      </div>
      <RepairScopePanel
        selectedProviderId={selectedProviderId}
        errorCode={diagnosis?.errorCode ?? "all"}
        state={initialState}
        search={initialSearch}
        resolverMode={resolverMode}
        guardrails={guardrails}
        scope={selectedScope}
        currentPreview={currentPreview}
        title="Selected repair scope"
        testId="provider-console-repair-scope"
      />
      {rows.length > 0 ? (
        <div className="grid gap-3 sm:hidden">
          {rows.map((row) => (
            <article key={row.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <label className="flex min-w-0 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={row.item ? selectedKeys.has(row.key) : false}
                    disabled={!row.item || allMatchingSelected}
                    onChange={(event) => toggleRowSelection(row.key, event.target.checked)}
                    aria-label={`Select ${row.sourceSymbol}`}
                  />
                  <span className="min-w-0">
                  <p className="font-mono font-semibold text-foreground">{row.sourceSymbol}</p>
                  <p className="text-xs text-muted-foreground">{row.providerSymbol}</p>
                  </span>
                </label>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{row.stateLabel}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <SettingReadout label="Candidate" value={row.candidateSymbol ?? "-"} />
                <SettingReadout label="Evidence" value={row.evidence ?? "-"} />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!row.item || !capability.supportsRenew || busyAction !== null} onClick={() => row.item ? onRenewItem(row.item) : undefined} title={row.item ? (renewDisabledReason ?? actionHelp.renew) : lifecycleUnavailable}>Renew</Button>
                <Button
                  size="sm"
                  disabled={!row.item || !capability.supportsRepair || busyAction !== null}
                  onClick={() => row.item ? (onFocusRowScope(row.item), onPreviewRepair({
                    type: "selected_items",
                    items: [{
                      providerId: row.item.providerId,
                      marketCode: row.item.marketCode,
                      errorCode: row.item.errorCode,
                      sourceSymbol: row.item.sourceSymbol,
                    }],
                  })) : undefined}
                  title={row.item && capability.supportsRepair ? (repairDisabledReason ?? actionHelp.repair) : "Repair is unavailable for this provider or row."}
                >
                  Repair
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rowRerunDisabled(row)}
                  title={rowRerunTitle(row)}
                  onClick={() => row.item ? onRerunItem(row.item) : undefined}
                  data-testid={`provider-console-unresolved-rerun-mobile-${row.sourceSymbol}`}
                >
                  Rerun
                </Button>
                {row.item && row.item.state !== "active" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canReopen || busyAction !== null}
                    title={actionHelp.reopen}
                    onClick={() => row.item ? onSetState(row.item, "active") : undefined}
                  >
                    Reopen
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!row.item || !canMarkUnsupported || busyAction !== null}
                      title={row.item ? actionHelp.markUnsupported : lifecycleUnavailable}
                      onClick={() => row.item ? onSetState(row.item, "unsupported") : undefined}
                    >
                      Unsupported
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!row.item || !canIgnore || busyAction !== null}
                      title={row.item ? actionHelp.ignore : lifecycleUnavailable}
                      onClick={() => row.item ? onSetState(row.item, "ignored") : undefined}
                    >
                      Ignore
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {row.item?.state === "resolved" && canRerun ? "Rerun will enqueue a fresh backfill for this resolved row." : "Rerun is disabled until this item is resolved or mapped."}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          No active durable unresolved rows found for this provider. Run Renew to refresh evidence or check Logs for raw occurrences.
        </div>
      )}
      <div className="hidden max-w-full overflow-x-auto rounded-xl border border-border sm:block">
        <table className="min-w-[920px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={visibleDurableRows.length === 0 || allMatchingSelected}
                  onChange={(event) => toggleVisibleSelection(event.target.checked)}
                  aria-label="Select visible rows"
                  data-testid="provider-console-select-visible"
                />
              </th>
              <th className="px-3 py-3">Source symbol</th>
              <th className="px-3 py-3">Provider symbol</th>
              <th className="px-3 py-3">Candidate</th>
              <th className="px-3 py-3">State</th>
              <th className="px-3 py-3">Evidence</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={row.item ? selectedKeys.has(row.key) : false}
                    disabled={!row.item || allMatchingSelected}
                    onChange={(event) => toggleRowSelection(row.key, event.target.checked)}
                    aria-label={`Select ${row.sourceSymbol}`}
                    data-testid={`provider-console-select-row-${row.sourceSymbol}`}
                  />
                </td>
                <td className="px-3 py-3 font-mono font-semibold">{row.sourceSymbol}</td>
                <td className="px-3 py-3 font-mono">{row.providerSymbol}</td>
                <td className="px-3 py-3 font-mono">{row.candidateSymbol ?? "-"}</td>
                <td className="px-3 py-3"><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{row.stateLabel}</span></td>
                <td className="px-3 py-3 break-words">{row.evidence ?? row.note}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" disabled={!row.item || !capability.supportsRenew || busyAction !== null} onClick={() => row.item ? onRenewItem(row.item) : undefined} title={row.item ? (renewDisabledReason ?? actionHelp.renew) : lifecycleUnavailable}>Renew</Button>
                    <Button
                      size="sm"
                      disabled={!row.item || !capability.supportsRepair || busyAction !== null}
                      onClick={() => row.item ? (onFocusRowScope(row.item), onPreviewRepair({
                        type: "selected_items",
                        items: [{
                          providerId: row.item.providerId,
                          marketCode: row.item.marketCode,
                          errorCode: row.item.errorCode,
                          sourceSymbol: row.item.sourceSymbol,
                        }],
                      })) : undefined}
                      title={row.item && capability.supportsRepair ? (repairDisabledReason ?? actionHelp.repair) : "Repair is unavailable for this provider or row."}
                    >
                      Repair
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rowRerunDisabled(row)}
                      title={rowRerunTitle(row)}
                      onClick={() => row.item ? onRerunItem(row.item) : undefined}
                      data-testid={`provider-console-unresolved-rerun-${row.sourceSymbol}`}
                    >
                      Rerun
                    </Button>
                    {row.item && row.item.state !== "active" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canReopen || busyAction !== null}
                        title={actionHelp.reopen}
                        onClick={() => row.item ? onSetState(row.item, "active") : undefined}
                        data-testid={`provider-console-unresolved-reopen-${row.sourceSymbol}`}
                      >
                        Reopen
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!row.item || !canMarkUnsupported || busyAction !== null}
                          title={row.item ? actionHelp.markUnsupported : lifecycleUnavailable}
                          onClick={() => row.item ? onSetState(row.item, "unsupported") : undefined}
                          data-testid={`provider-console-unresolved-unsupported-${row.sourceSymbol}`}
                        >
                          Unsupported
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!row.item || !canIgnore || busyAction !== null}
                          title={row.item ? actionHelp.ignore : lifecycleUnavailable}
                          onClick={() => row.item ? onSetState(row.item, "ignored") : undefined}
                          data-testid={`provider-console-unresolved-ignore-${row.sourceSymbol}`}
                        >
                          Ignore
                        </Button>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    {row.item?.state === "resolved" && canRerun ? "Rerun enqueues fresh backfill." : "Rerun requires resolved mapping."}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={unresolvedPage}
        limit={unresolvedLimit}
        total={unresolvedTotal}
        onPageChange={(page) => applyCurrentFilters(page)}
      />
      {rows.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur sm:hidden"
          data-testid="provider-console-mobile-bottom-actions"
        >
          <div className="mx-auto flex max-w-md items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{formatNumber(selectedCount)} selected</p>
              <p className="truncate text-[11px] text-muted-foreground">{selectedProviderId}</p>
            </div>
            <Button size="sm" disabled={!canRepairSelected} onClick={previewSelectedScope} title={canRepairSelected ? actionHelp.repair : "Select durable rows before repair."}>Repair</Button>
            <Button size="sm" variant="secondary" onClick={() => (allMatchingSelected ? onClearSelection() : onSelectAllMatching())}>{allMatchingSelected ? "Clear" : "All matching"}</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function RepairScopePanel({
  selectedProviderId,
  errorCode,
  state,
  search,
  resolverMode,
  guardrails,
  scope,
  currentPreview,
  title,
  testId,
}: {
  selectedProviderId: string;
  errorCode: string;
  state: ProviderUnresolvedItemDto["state"] | "all";
  search: string;
  resolverMode: ProviderFixerDashboardDiagnosticsDto["resolverMode"];
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  scope: UnresolvedScopeSelection | null;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  title: string;
  testId?: string;
}) {
  const guardrailLevel = scopeGuardrailLevel(scope, guardrails);
  const previewStatus = !currentPreview
    ? "No preview loaded"
    : previewExpired(currentPreview)
      ? "Preview expired"
      : previewMatchesScope(currentPreview, scope)
        ? `${(currentPreview.scopeType ?? "legacy").replace(/_/g, " ")} preview ready`
        : "Preview scope does not match selection";

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid={testId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">Preview sample rows are display-only. Execution applies to the frozen selected or all-matching scope.</p>
        </div>
        <span className={cn(
          "w-fit rounded-full px-2 py-1 text-xs font-semibold",
          previewStatus === "No preview loaded" && "bg-slate-100 text-slate-700",
          previewStatus === "Preview expired" && "bg-rose-100 text-rose-700",
          previewStatus.endsWith("ready") && "bg-emerald-100 text-emerald-700",
          previewStatus.includes("does not match") && "bg-amber-100 text-amber-800",
        )}>
          {previewStatus}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SettingReadout label="Provider" value={selectedProviderId} />
        <SettingReadout label="Error code" value={errorCode} />
        <SettingReadout label="State / search" value={`${state}${search.trim() ? ` / ${search.trim()}` : ""}`} />
        <SettingReadout label="Scope type" value={scope?.type === "filter" ? "All matching filter" : scope ? "Selected rows" : "None selected"} />
        <SettingReadout label="Count" value={scope ? formatNumber(scope.count) : "0"} />
        <SettingReadout label="Resolver mode" value={resolverMode ? resolverMode.replace(/_/g, " ") : "unknown"} />
        <SettingReadout label="Guardrail level" value={guardrailLevel ? guardrailLevel.replace(/_/g, " ") : "none"} />
        <SettingReadout label="Preview" value={previewStatus} />
      </dl>
    </div>
  );
}

function FixerTab({
  selectedProviderId,
  diagnostics,
  diagnosis,
  guardrails,
  capability,
  renewDisabledReason,
  repairDisabledReason,
  rerunDisabledReason,
  selectedScope,
  currentPreview,
  selectedOperation,
  confirmationChecked,
  typedConfirmation,
  typedConfirmationRequired,
  executeDisabled,
  executeBlockers,
  busyAction,
  actionError,
  setConfirmationChecked,
  setTypedConfirmation,
  onRenewEvidence,
  onPreviewRepair,
  onUseAllMatchingScope,
  onOpenUnresolvedScope,
  onExecute,
  onControlOperation,
}: {
  selectedProviderId: string;
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  capability: ProviderOperationCapabilityDto;
  renewDisabledReason: string | null;
  repairDisabledReason: string | null;
  rerunDisabledReason: string;
  selectedScope: UnresolvedScopeSelection | null;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  selectedOperation: ProviderFixerDashboardOperationDto | null;
  confirmationChecked: boolean;
  typedConfirmation: string;
  typedConfirmationRequired: boolean;
  executeDisabled: boolean;
  executeBlockers: ExecuteBlocker[];
  busyAction: string | null;
  actionError: string | null;
  setConfirmationChecked: (checked: boolean) => void;
  setTypedConfirmation: (value: string) => void;
  onRenewEvidence: () => void;
  onPreviewRepair: () => void;
  onUseAllMatchingScope: () => void;
  onOpenUnresolvedScope: () => void;
  onExecute: () => void;
  onControlOperation: (action: "pause" | "resume" | "cancel") => void;
}) {
  const stagedVisible = !!selectedOperation && (
    selectedOperation.phase === "preparing_preview"
    || selectedOperation.phase === "preview"
    || selectedOperation.phase === "staged"
    || selectedOperation.phase === "queued"
    || selectedOperation.phase === "running"
    || selectedOperation.phase === "paused"
  );
  const dangerousPreviewSheet = stagedVisible && selectedOperation?.dangerous;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Fixer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Repair, Renew, and Rerun are scoped to {selectedProviderId}. Unsupported actions stay visible with reasons.
            </p>
          </div>
          {capability.supportsResolverModes ? (
            <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
              <span
                className={cn("px-3 py-2", diagnostics.resolverMode === "quote_first" ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground")}
                title={resolverModeHelp.quote_first}
              >
                Quote-first
              </span>
              <span
                className={cn("border-l border-border px-3 py-2", diagnostics.resolverMode === "chart_probe_v1" ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground")}
                title={resolverModeHelp.chart_probe_v1}
              >
                Chart-probe
              </span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Active unresolved" value={formatNumber(diagnosis?.unresolvedCount ?? 0)} detail={diagnosis?.errorCode ?? "No active error code"} />
          <Metric label="Guardrail threshold" value={formatNumber(guardrails.dangerousMatchThreshold)} detail="Bulk writes above this require typed phrase." />
          <Metric label="Preview sample" value={formatNumber(guardrails.previewSampleLimit)} detail="Rows shown before dangerous execution." />
        </div>
        <RepairScopePanel
          selectedProviderId={selectedProviderId}
          errorCode={diagnosis?.errorCode ?? diagnostics.errorCode}
          state="active"
          search={currentPreview?.search ?? ""}
          resolverMode={diagnostics.resolverMode}
          guardrails={guardrails}
          scope={selectedScope}
          currentPreview={currentPreview}
          title="Fixer scope"
          testId="provider-console-fixer-scope"
        />
        <div className="grid gap-3 md:grid-cols-3">
          <ActionPanel title="Renew" body={actionHelp.renew} enabled={capability.supportsRenew} disabledReason={renewDisabledReason ?? ""} actionLabel="Renew evidence" onClick={() => onRenewEvidence()} busy={busyAction !== null} testId="provider-console-renew-evidence" />
          <ActionPanel title="Repair" body={actionHelp.repair} enabled={capability.supportsRepair} disabledReason={repairDisabledReason ?? ""} actionLabel="Preview repair" onClick={onPreviewRepair} busy={busyAction !== null} />
          <ActionPanel title="Rerun" body={actionHelp.rerun} enabled={false} disabledReason={rerunDisabledReason} actionLabel="Rerun disabled" />
        </div>
        {!selectedScope ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onOpenUnresolvedScope}>Select visible rows</Button>
            <Button variant="secondary" onClick={onUseAllMatchingScope}>Use all matching filter scope</Button>
          </div>
        ) : null}
        {actionError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p> : null}
      </Card>

      {stagedVisible ? (
        <>
          {dangerousPreviewSheet ? (
            <div className="fixed inset-0 z-40 bg-foreground/35 backdrop-blur-sm sm:hidden" aria-hidden="true" data-testid="provider-console-mobile-preview-backdrop" />
          ) : null}
          <Card
            className={cn(
              "space-y-4 px-4 py-4 hover:translate-y-0",
              dangerousPreviewSheet
                ? "fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-b-none rounded-t-2xl border-x-0 border-b-0 shadow-2xl sm:static sm:max-h-none sm:rounded-xl sm:border sm:shadow-sm"
                : "",
            )}
            data-testid="provider-console-operation-panel"
          >
          {dangerousPreviewSheet ? (
            <span className="sr-only sm:hidden" data-testid="provider-console-mobile-dangerous-preview">
              Mobile dangerous operation preview sheet
            </span>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Operation preview</h3>
              <p className="mt-1 text-sm text-muted-foreground">Dangerous work uses snapshot and confirmation guardrails.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", phaseTone[selectedOperation.phase])}>
                {selectedOperation.phase}
              </span>
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", selectedOperation.dangerous ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                {selectedOperation.dangerous ? "Dangerous" : "Small write"}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">Operation state</p>
                <p className="text-muted-foreground">
                  {selectedOperation.phase === "preparing_preview"
                    ? "Preview preparation started. The scope is frozen, sample generation is running, and the operation can still be cancelled."
                    : selectedOperation.phase === "queued"
                    ? "Accepted and waiting behind active provider work. Progress remains zero until the operation starts."
                    : `${operationProgress(selectedOperation)}% progress from durable operation outcomes.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedOperation.canPause ? (
                  <Button size="sm" variant="secondary" onClick={() => onControlOperation("pause")}>Pause</Button>
                ) : null}
                {selectedOperation.canResume ? (
                  <Button size="sm" variant="secondary" onClick={() => onControlOperation("resume")}>Resume</Button>
                ) : null}
                {selectedOperation.canCancel ? (
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => onControlOperation("cancel")}>
                    {selectedOperation.phase === "queued" ? "Cancel queued" : "Cancel"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {currentPreview ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Scope" value={formatNumber(currentPreview.matchCount)} detail="Frozen match count" />
                <Metric label="Sample" value={formatNumber(currentPreview.sampleCount)} detail={`${currentPreview.totalPages} preview pages`} />
              </div>
              <dl className="space-y-3 rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <SettingReadout label="Scope label" value={currentPreview.scopeLabel} />
                <SettingReadout label="Snapshot hash" value={currentPreview.snapshotHash} />
                <SettingReadout label="Confirmation phrase" value={currentPreview.confirmationText ?? "Checkbox only"} />
                <SettingReadout label="Preview expiry" value={formatTimestamp(currentPreview.tokenExpiresAt)} />
              </dl>
              <div className="rounded-xl border border-border bg-card p-3" data-testid="provider-console-execute-blockers">
                <p className="text-sm font-semibold text-foreground">Execute blockers</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {executeBlockers.map((blocker) => (
                    <li key={blocker.label} className="flex items-start gap-2">
                      <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", blocker.satisfied ? "bg-emerald-500" : "bg-amber-500")} aria-hidden="true" />
                      <span>
                        <strong className="text-foreground">{blocker.label}</strong>
                        <span className="block text-muted-foreground">{blocker.help}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <label className="flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm">
                <input type="checkbox" checked={confirmationChecked} onChange={(event) => setConfirmationChecked(event.target.checked)} data-testid="provider-console-confirm-checkbox" />
                <span>{currentPreview.acknowledgementLabel}</span>
              </label>
              {typedConfirmationRequired ? (
                <label className="grid gap-1 text-sm text-muted-foreground">
                  <span>Type confirmation phrase</span>
                  <input
                    className="h-10 rounded-lg border border-input bg-background px-3 font-mono text-foreground"
                    value={typedConfirmation}
                    onChange={(event) => setTypedConfirmation(event.target.value)}
                    placeholder={currentPreview.confirmationText ?? ""}
                    data-testid="provider-console-typed-confirmation"
                  />
                </label>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={onPreviewRepair} title="Refresh the preview snapshot before executing; execution still requires matching confirmation.">Refresh preview</Button>
                <Button disabled={executeDisabled} onClick={onExecute} data-testid="provider-console-execute-button" title={executeDisabled ? "Execution stays disabled until the checkbox and typed phrase match the current preview." : "Execute the current guarded operation preview."}>Execute operation</Button>
              </div>
            </>
          ) : null}
          </Card>
        </>
      ) : (
        <Card className="px-4 py-4 hover:translate-y-0">
          <h3 className="text-xl font-semibold text-foreground">No staged operation</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            This section appears only after a repair preview is created or an operation is queued, running, or paused.
          </p>
        </Card>
      )}
    </div>
  );
}

function OperationsTab({
  operations,
  operationColumns,
  selectedOperation,
  requestedOperationMissing,
  requestedOperationId,
  selectedProviderId,
  initialOutcomeState,
  initialOutcomeAction,
  inspectorRef,
  onOpenLogs,
  onOpenIncidents,
  onOpenUnresolved,
  onPageChange,
  progressOperation,
  selectedScope,
  outcomes,
  outcomeSummary,
  outcomesPage,
  outcomesLimit,
  outcomesTotal,
  onOutcomeRouteChange,
  onInspectOperation,
  page,
  limit,
  total,
}: {
  operations: ProviderFixerDashboardOperationDto[];
  operationColumns: DataTableColumn<ProviderFixerDashboardOperationDto>[];
  selectedOperation: ProviderFixerDashboardOperationDto | null;
  requestedOperationMissing: boolean;
  requestedOperationId: string;
  selectedProviderId: string;
  initialOutcomeState: ProviderOperationOutcomeDto["state"] | "all";
  initialOutcomeAction: string;
  inspectorRef: MutableRefObject<HTMLDivElement | null>;
  onOpenLogs: (operationId: string) => void;
  onOpenIncidents: () => void;
  onOpenUnresolved: () => void;
  onPageChange: (page: number) => void;
  progressOperation: ProviderFixerDashboardOperationDto | null;
  selectedScope: UnresolvedScopeSelection | null;
  outcomes: ProviderOperationOutcomeDto[];
  outcomeSummary: ProviderOperationOutcomeSummaryDto;
  outcomesPage: number;
  outcomesLimit: number;
  outcomesTotal: number;
  onOutcomeRouteChange: (next: {
    page?: number;
    state?: ProviderOperationOutcomeDto["state"] | "all";
    action?: string;
  }) => void;
  onInspectOperation: (operationId: string) => void;
  page: number;
  limit: number;
  total: number;
}) {
  const operationScope = selectedOperation?.preview.frozenScope
    ? {
        type: selectedOperation.preview.frozenScope.type,
        count: selectedOperation.preview.frozenScope.matchCount,
        label: selectedOperation.preview.scopeSummary,
        filterFingerprint: selectedOperation.preview.frozenScope.filterFingerprint,
        selectedItems: selectedOperation.preview.frozenScope.selectedItems,
        filter: selectedOperation.preview.frozenScope.filter,
      }
    : selectedScope;
  const currentOperation =
    operations.find((operation) => operation.phase === "running")
    ?? operations.find((operation) => operation.phase === "paused")
    ?? operations.find((operation) => operation.phase === "preparing_preview")
    ?? operations.find((operation) => operation.phase === "queued")
    ?? progressOperation;
  return (
    <div className="grid gap-4">
      {currentOperation ? (
        <Card className="px-4 py-4 hover:translate-y-0" data-testid="provider-console-current-operation-banner">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Current operation</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-foreground">{currentOperation.id}</span>
                <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", phaseTone[currentOperation.phase])}>
                  {currentOperation.phase}
                </span>
                <span className="text-sm text-muted-foreground">
                  {operationProgress(currentOperation)}% complete across {formatNumber(currentOperation.matchCount)} matched rows.
                </span>
              </div>
            </div>
            {selectedOperation?.id !== currentOperation.id ? (
              <Button size="sm" variant="secondary" onClick={() => onInspectOperation(currentOperation.id)}>
                Inspect current operation
              </Button>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Inspector focused
              </span>
            )}
          </div>
        </Card>
      ) : null}
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Provider operations</h3>
          <p className="mt-1 text-sm text-muted-foreground">Operation history stays paginated. Inspect a row to open the selected-operation inspector below.</p>
        </div>
        <DataTable
          data-testid="provider-console-operations-table"
          data={operations}
          columns={operationColumns}
          rowKey={(operation) => operation.id}
          emptyState={<div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No provider operations found.</div>}
        />
        <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
      </Card>
      <div
        ref={inspectorRef}
        tabIndex={-1}
        className="scroll-mt-24 outline-none"
        data-testid="provider-console-operation-inspector-focus"
      >
      <Card
        className={cn(
          "space-y-4 px-4 py-4 hover:translate-y-0 transition-colors",
          selectedOperation ? "ring-2 ring-primary/30" : "",
        )}
        data-testid="provider-console-operation-inspector"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Selected operation inspector</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Progress, scope, durable outcomes, and related provider-console views for the selected operation.
            </p>
          </div>
          {selectedOperation ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onOpenLogs(selectedOperation.id)} data-testid="provider-console-operation-open-logs">
                Open logs
              </Button>
              <Button size="sm" variant="secondary" onClick={onOpenIncidents} data-testid="provider-console-operation-open-incidents">
                Open incidents
              </Button>
              <Button size="sm" variant="secondary" onClick={onOpenUnresolved}>
                Open unresolved
              </Button>
            </div>
          ) : null}
        </div>
        {requestedOperationMissing ? (
          <Reason
            tone="warning"
            title="Selected operation is not loaded on this page"
            body={`Operation ${requestedOperationId} is in the URL, but the current operations response did not include it. Inspect another loaded row or load the page that contains it.`}
          />
        ) : null}
        {selectedOperation ? (
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Provider" value={selectedProviderId} detail={selectedOperation.market ?? "Provider market"} />
            <Metric label="Phase" value={selectedOperation.phase} detail={selectedOperation.canRetry ? "Retry available" : "Retry unavailable"} />
            <Metric label="Progress" value={`${operationProgress(selectedOperation)}%`} detail={`${formatNumber(outcomeSummary.processed)} processed outcomes`} />
            <Metric label="Rate cap" value={`${selectedOperation.effectiveRateCapPerMinute ?? 250}/min`} detail={`${formatNumber(selectedOperation.autoPauseFailureCount ?? 0)} auto-pause failures`} />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Select an operation to inspect details and outcomes.</p>
        )}
        {selectedOperation ? (
          <>
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-muted-foreground">{selectedOperation.id}</span>
                <span>{operationProgress(selectedOperation)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${operationProgress(selectedOperation)}%` }} />
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedOperation.phase === "preparing_preview"
                  ? "Preparing preview samples from the frozen scope."
                  : `${selectedOperation.phase.replace(/_/g, " ")} progress from durable operation outcomes.`}
              </p>
            </div>
            {selectedOperation.preview ? (
              <RepairScopePanel
                selectedProviderId={selectedProviderId}
                errorCode={selectedOperation.preview.frozenScope?.filter?.errorCode ?? selectedOperation.preview.scopeLabel}
                state={selectedOperation.preview.state ?? "active"}
                search={selectedOperation.preview.search ?? ""}
                resolverMode="quote_first"
                guardrails={{
                  dangerousMatchThreshold: selectedOperation.dangerous ? selectedOperation.matchCount : Number.MAX_SAFE_INTEGER,
                  previewSampleLimit: selectedOperation.preview.sampleCount,
                  uiPageSize: selectedOperation.preview.sampleCount,
                  autoPauseFailureThresholdPerMinute: selectedOperation.autoPauseFailureThresholdPerMinute ?? 0,
                  previewTokenTtlSeconds: 0,
                  healthWarningUnresolvedThreshold: 0,
                  healthCriticalUnresolvedThreshold: 0,
                }}
                scope={operationScope}
                currentPreview={selectedOperation.preview}
                title="Selected operation scope"
              />
            ) : (
              <Reason
                tone="info"
                title="No preview snapshot stored"
                body="This operation does not expose a frozen preview scope. Progress and outcomes remain available below."
              />
            )}
          </>
        ) : null}
        <div>
          <h4 className="text-lg font-semibold text-foreground">Operation item outcomes</h4>
          <p className="mt-1 text-sm text-muted-foreground">Durable token-level results for the selected provider operation.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>Outcome state</span>
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={initialOutcomeState}
              onChange={(event) => onOutcomeRouteChange({ state: event.target.value as ProviderOperationOutcomeDto["state"] | "all", page: 1 })}
              data-testid="provider-console-operation-outcome-state"
            >
              <option value="all">All states</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
              <option value="rate_limited">Rate limited</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>Action contains</span>
            <input
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              value={initialOutcomeAction}
              onChange={(event) => onOutcomeRouteChange({ action: event.target.value, page: 1 })}
              placeholder="repair_mapping"
              data-testid="provider-console-operation-outcome-action"
            />
          </label>
          <div className="md:self-end">
            <Button size="sm" variant="secondary" onClick={() => onOutcomeRouteChange({ state: "all", action: "", page: 1 })}>
              Reset filters
            </Button>
          </div>
        </div>
        {outcomes.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Token</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">State</th>
                  <th className="px-3 py-3">Message</th>
                  <th className="px-3 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((outcome) => (
                  <tr key={`${outcome.operationId}-${outcome.action}-${outcome.sourceSymbol}`} className="border-t border-border">
                    <td className="px-3 py-3 font-mono font-semibold">{outcome.sourceSymbol}</td>
                    <td className="px-3 py-3">{outcome.action.replace(/_/g, " ")}</td>
                    <td className="px-3 py-3"><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{outcome.state.replace(/_/g, " ")}</span></td>
                    <td className="px-3 py-3 break-words">{outcome.message ?? outcome.errorCode ?? "-"}</td>
                    <td className="px-3 py-3 font-mono text-muted-foreground">{formatTimestamp(outcome.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No item outcomes recorded for this operation yet.</p>
        )}
        <Pagination page={outcomesPage} limit={outcomesLimit} total={outcomesTotal} onPageChange={(nextPage) => onOutcomeRouteChange({ page: nextPage })} />
      </Card>
      </div>
    </div>
  );
}

function IncidentsTab({
  selectedProviderId,
  incidents,
  page,
  limit,
  total,
  onPageChange,
  onSetStatus,
  busyAction,
}: {
  selectedProviderId: string;
  incidents: ProviderIncidentDto[];
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onSetStatus: (incidentId: string, status: ProviderIncidentDto["status"]) => void;
  busyAction: string | null;
}) {
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div>
        <h3 className="text-xl font-semibold text-foreground">Incidents</h3>
        <p className="mt-1 text-sm text-muted-foreground">Durable provider incident lifecycle for {selectedProviderId}, grouped from repeated provider errors.</p>
      </div>
      {incidents.length > 0 ? (
        <>
        <div className="grid gap-3 md:hidden">
          {incidents.map((incident) => {
            const busy = busyAction?.startsWith(`incident:`) && busyAction.endsWith(`:${incident.id}`);
            return (
              <article key={incident.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground break-words">{incident.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground break-words">{incident.summary ?? incident.incidentKey}</p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{incident.status}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <SettingReadout label="Severity" value={incident.severity} />
                  <SettingReadout label="Error" value={incident.errorCode ?? incident.errorClass} />
                  <SettingReadout label="Count" value={formatNumber(incident.occurrenceCount)} />
                  <SettingReadout label="Last seen" value={formatTimestamp(incident.lastSeenAt)} />
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {incident.status === "open" ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "acknowledged")}>Acknowledge</Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "resolved")}>Resolve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus(incident.id, "ignored")}>Ignore</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "open")}>Reopen</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden overflow-hidden rounded-xl border border-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Incident</th>
                <th className="px-3 py-3">State</th>
                <th className="px-3 py-3">Severity</th>
                <th className="px-3 py-3">Error</th>
                <th className="px-3 py-3">Count</th>
                <th className="px-3 py-3">Last seen</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => {
                const busy = busyAction?.startsWith(`incident:`) && busyAction.endsWith(`:${incident.id}`);
                return (
                  <tr key={incident.id} className="border-t border-border align-top">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-foreground">{incident.title}</div>
                      <div className="mt-1 max-w-[34rem] break-words text-xs text-muted-foreground">{incident.summary ?? incident.incidentKey}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{incident.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn(
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        incident.severity === "critical"
                          ? "bg-rose-100 text-rose-700"
                          : incident.severity === "warning"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700",
                      )}>{incident.severity}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{incident.errorCode ?? incident.errorClass}</td>
                    <td className="px-3 py-3 font-mono">{formatNumber(incident.occurrenceCount)}</td>
                    <td className="px-3 py-3 font-mono text-muted-foreground">{formatTimestamp(incident.lastSeenAt)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {incident.status === "open" ? (
                          <>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "acknowledged")}>Acknowledge</Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "resolved")}>Resolve</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus(incident.id, "ignored")}>Ignore</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus(incident.id, "open")}>Reopen</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No open incidents for this provider.</p>
      )}
      <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
    </Card>
  );
}

function ActivityTab({
  selectedProviderId,
  items,
  page,
  limit,
  total,
  onPageChange,
}: {
  selectedProviderId: string;
  items: ProviderActivityItemDto[];
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <h3 className="text-xl font-semibold text-foreground">Activity</h3>
      <p className="text-sm text-muted-foreground">Provider-scoped timeline composed from operations, logs, incidents, unresolved items, and mappings.</p>
      <div className="space-y-0">
        {items.length > 0 ? (
          <>
            <div className="grid gap-3 md:hidden">
              {items.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-border bg-card p-4 text-sm">
                  <p className="font-mono text-xs text-muted-foreground">{formatTimestamp(entry.occurredAt)}</p>
                  <span className="mt-2 inline-flex w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{entry.kind}</span>
                  <p className="mt-3 break-words"><strong>{entry.title}</strong>{entry.detail ? ` - ${entry.detail}` : ""}</p>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              {items.map((entry) => (
                <div key={entry.id} className="grid gap-2 border-b border-border py-3 text-sm last:border-b-0 md:grid-cols-[170px_130px_1fr]">
                  <span className="font-mono text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
                  <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{entry.kind}</span>
                  <span className="break-words"><strong>{entry.title}</strong>{entry.detail ? ` - ${entry.detail}` : ""}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Reason tone="info" title={`No recent activity for ${selectedProviderId}`} body="Activity will populate from provider operation logs, incidents, unresolved items, and mappings." />
        )}
      </div>
      <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
    </Card>
  );
}

function LogsTab({
  logs,
  page,
  limit,
  total,
  selectedProviderId,
  purgePreview,
  purgeConfirmation,
  onPurgeConfirmationChange,
  onPreviewPurge,
  onExecutePurge,
  busyAction,
  onPageChange,
}: {
  logs: ProviderFixerDashboardLogEntryDto[];
  page: number;
  limit: number;
  total: number;
  selectedProviderId: string;
  purgePreview: ProviderLogPurgePreviewDto | null;
  purgeConfirmation: string;
  onPurgeConfirmationChange: (value: string) => void;
  onPreviewPurge: () => void;
  onExecutePurge: () => void;
  busyAction: string | null;
  onPageChange: (page: number) => void;
}) {
  const purgeReady =
    !!purgePreview
    && purgePreview.canExecute
    && purgeConfirmation === purgePreview.confirmationText
    && busyAction !== "purge-execute";
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Logs</h3>
          <p className="mt-1 text-sm text-muted-foreground">Raw/system diagnostics for {selectedProviderId}. Purge only removes raw provider error trail rows and provider operation logs.</p>
        </div>
        <Button variant="destructive" disabled={busyAction === "purge-preview"} onClick={onPreviewPurge} title={actionHelp.purge}>Preview purge</Button>
      </div>
      {purgePreview ? (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4">
          <div>
            <h4 className="font-semibold text-red-800">Purge preview</h4>
            <p className="mt-1 text-sm text-red-700">{purgePreview.boundary}</p>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <Metric label="Provider errors" value={formatNumber(purgePreview.errorTrailCount)} detail="provider_error_trail rows" />
            <Metric label="Operation logs" value={formatNumber(purgePreview.operationLogCount)} detail="provider_operation_logs rows" />
            <Metric label="Preview expires" value={formatTimestamp(purgePreview.tokenExpiresAt)} detail="Run preview again after expiry" />
          </div>
          <label className="block text-sm font-medium text-red-800" htmlFor="provider-log-purge-confirmation">
            Type {purgePreview.confirmationText} to execute
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="provider-log-purge-confirmation"
              className="min-h-10 flex-1 rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-red-500"
              value={purgeConfirmation}
              onChange={(event) => onPurgeConfirmationChange(event.target.value)}
              placeholder={purgePreview.confirmationText}
              title="Typed confirmation must exactly match the purge preview phrase."
            />
            <Button variant="destructive" disabled={!purgeReady} onClick={onExecutePurge} title={purgeReady ? "Delete only the eligible raw provider logs in this preview." : "Execute purge is disabled until the typed confirmation matches the preview phrase."}>Execute purge</Button>
          </div>
        </div>
      ) : null}
      {logs.length > 0 ? (
        <div className="space-y-0">
          {logs.map((entry) => (
            <div key={entry.id} className="grid gap-2 border-b border-border py-3 text-sm last:border-b-0 md:grid-cols-[170px_1fr]">
              <span className="font-mono text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
              <span className="font-mono text-foreground"><span className="text-muted-foreground">phase={entry.phase}</span> {entry.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No raw provider logs for this scope.</p>
      )}
      <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
    </Card>
  );
}

function MappingsTab({
  selectedProviderId,
  capability,
  mappings,
  page,
  limit,
  total,
  search,
  currentPreview,
  evidenceColumns,
  onReverifyMapping,
  onRevertMapping,
  onRerunMapping,
  onOpenUnresolvedMapping,
  onOpenMappingOperation,
  onPageChange,
  onSearchChange,
  busyAction,
}: {
  selectedProviderId: string;
  capability: ProviderOperationCapabilityDto;
  mappings: ProviderResolutionMappingDto[];
  page: number;
  limit: number;
  total: number;
  search: string;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  evidenceColumns: DataTableColumn<NonNullable<ProviderFixerDashboardOperationDto["preview"]>["evidenceSample"][number]>[];
  onReverifyMapping: (mapping: ProviderResolutionMappingDto) => void;
  onRevertMapping: (mapping: ProviderResolutionMappingDto, typedConfirmation: string) => void;
  onRerunMapping: (mapping: ProviderResolutionMappingDto) => void;
  onOpenUnresolvedMapping: (mapping: ProviderResolutionMappingDto) => void;
  onOpenMappingOperation: (mapping: ProviderResolutionMappingDto) => void;
  onPageChange: (page: number) => void;
  onSearchChange: (search: string) => void;
  busyAction: string | null;
}) {
  const evidenceRows = currentPreview?.evidenceSample ?? [];
  const reverifySupported = actionSupported(capability, "reverify_mapping");
  const revertSupported = actionSupported(capability, "revert_mapping");
  const rerunSupported = actionSupported(capability, "rerun_backfill");
  const reverifyReason = actionDisabledReason(capability, "reverify_mapping", "Reverify is unavailable for this provider.");
  const revertReason = actionDisabledReason(capability, "revert_mapping", "Revert is unavailable for this provider.");
  const rerunReason = actionDisabledReason(capability, "rerun_backfill", "Rerun is unavailable for this provider.");
  const [revertTarget, setRevertTarget] = useState<string | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState("");
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div>
        <h3 className="text-xl font-semibold text-foreground">Mappings</h3>
        <p className="mt-1 text-sm text-muted-foreground">Durable source catalog to provider-symbol bindings where supported.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm text-muted-foreground">
          <span>Search mappings</span>
          <input
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Source symbol, provider symbol, or operation ID"
            data-testid="provider-console-mappings-search"
          />
        </label>
        <div className="md:self-end">
          <Button size="sm" variant="secondary" onClick={() => onSearchChange("")}>
            Clear search
          </Button>
        </div>
      </div>
      {capability.supportsMappings ? (
        mappings.length > 0 ? (
          <>
            <div className="grid gap-3 md:hidden" data-testid="provider-console-mappings-cards">
              {mappings.map((mapping) => {
                const linkedOperationId = mappingLinkedOperation(mapping.evidence);
                return (
                  <article key={`${mapping.providerId}-${mapping.marketCode}-${mapping.sourceSymbol}-card`} className="rounded-xl border border-border bg-card p-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono font-semibold text-foreground">{mapping.sourceSymbol}</p>
                        <p className="mt-1 font-mono text-muted-foreground">{mapping.resolvedSymbol}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {mapping.resolverMode?.replace(/_/g, " ") ?? "manual"}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">Verified {formatTimestamp(mapping.verifiedAt)}</p>
                    <p className="mt-3 break-words text-sm text-muted-foreground">{mappingEvidenceSummary(mapping.evidence)}</p>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        className="block font-mono text-blue-700 underline-offset-2 hover:underline"
                        onClick={() => onOpenUnresolvedMapping(mapping)}
                        data-testid={`provider-console-mapping-unresolved-link-${mapping.sourceSymbol}-mobile`}
                      >
                        Unresolved: {mapping.sourceSymbol}
                      </button>
                      {linkedOperationId ? (
                        <button
                          type="button"
                          className="block font-mono text-blue-700 underline-offset-2 hover:underline"
                          onClick={() => onOpenMappingOperation(mapping)}
                          data-testid={`provider-console-mapping-operation-link-${mapping.sourceSymbol}-mobile`}
                        >
                          Operation: {linkedOperationId}
                        </button>
                      ) : (
                        <span>Operation: not linked</span>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={!reverifySupported || busyAction !== null} onClick={() => onReverifyMapping(mapping)}>
                        Reverify
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!rerunSupported || busyAction !== null} onClick={() => onRerunMapping(mapping)}>
                        Rerun
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!revertSupported || busyAction !== null}
                        onClick={() => {
                          const key = `${mapping.providerId}-${mapping.marketCode}-${mapping.sourceSymbol}`;
                          setRevertTarget(revertTarget === key ? null : key);
                          setRevertConfirmation("");
                        }}
                      >
                        Revert
                      </Button>
                    </div>
                    {revertTarget === `${mapping.providerId}-${mapping.marketCode}-${mapping.sourceSymbol}` ? (
                      <div className="mt-4 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="text-xs text-red-800">
                          Type <span className="font-mono">{`REVERT ${mapping.sourceSymbol}`}</span> to remove this mapping.
                        </p>
                        <input
                          className="min-h-10 w-full rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-red-500"
                          value={revertConfirmation}
                          onChange={(event) => setRevertConfirmation(event.target.value)}
                          placeholder={`REVERT ${mapping.sourceSymbol}`}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revertConfirmation.trim() !== `REVERT ${mapping.sourceSymbol}` || busyAction !== null}
                          onClick={() => onRevertMapping(mapping, revertConfirmation.trim())}
                        >
                          Execute revert
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Provider symbol</th>
                    <th className="px-3 py-3">Resolver</th>
                    <th className="px-3 py-3">Verified</th>
                    <th className="px-3 py-3">Evidence</th>
                    <th className="px-3 py-3">Linked context</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => {
                    const key = `${mapping.providerId}-${mapping.marketCode}-${mapping.sourceSymbol}`;
                    const phrase = `REVERT ${mapping.sourceSymbol}`;
                    const revertOpen = revertTarget === key;
                    const revertReady = revertConfirmation.trim() === phrase;
                    const linkedOperationId = mappingLinkedOperation(mapping.evidence);
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-border">
                          <td className="px-3 py-3">
                            <div className="font-mono font-semibold text-foreground">{mapping.sourceSymbol}</div>
                            <div className="text-xs text-muted-foreground">{mapping.marketCode}</div>
                          </td>
                          <td className="px-3 py-3 font-mono">{mapping.resolvedSymbol}</td>
                          <td className="px-3 py-3">{mapping.resolverMode?.replace(/_/g, " ") ?? "manual"}</td>
                          <td className="px-3 py-3 font-mono text-muted-foreground">{formatTimestamp(mapping.verifiedAt)}</td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            {mappingEvidenceSummary(mapping.evidence)}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            <button
                              type="button"
                              className="font-mono text-blue-700 underline-offset-2 hover:underline"
                              onClick={() => onOpenUnresolvedMapping(mapping)}
                              title="Open the unresolved instruments tab filtered to this source symbol."
                              data-testid={`provider-console-mapping-unresolved-link-${mapping.sourceSymbol}`}
                            >
                              Unresolved: {mapping.sourceSymbol}
                            </button>
                            <div>
                              {linkedOperationId ? (
                                <button
                                  type="button"
                                  className="font-mono text-blue-700 underline-offset-2 hover:underline"
                                  onClick={() => onOpenMappingOperation(mapping)}
                                  title="Open the operation that created or last verified this mapping."
                                  data-testid={`provider-console-mapping-operation-link-${mapping.sourceSymbol}`}
                                >
                                  Operation: {linkedOperationId}
                                </button>
                              ) : (
                                "Operation: not linked"
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!reverifySupported || busyAction !== null}
                                title={reverifySupported ? "Reverify will create a provider operation for this durable mapping." : reverifyReason ?? undefined}
                                onClick={() => onReverifyMapping(mapping)}
                                data-testid={`provider-console-mapping-reverify-${mapping.sourceSymbol}`}
                              >
                                Reverify
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!rerunSupported || busyAction !== null}
                                title={rerunSupported ? "Rerun creates a provider operation that enqueues a fresh backfill for this mapped row." : rerunReason ?? undefined}
                                onClick={() => onRerunMapping(mapping)}
                                data-testid={`provider-console-mapping-rerun-${mapping.sourceSymbol}`}
                              >
                                Rerun
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!revertSupported || busyAction !== null}
                                title={revertSupported ? "Revert requires typing the exact phrase before removing this mapping." : revertReason ?? undefined}
                                onClick={() => {
                                  setRevertTarget(revertOpen ? null : key);
                                  setRevertConfirmation("");
                                }}
                                data-testid={`provider-console-mapping-revert-open-${mapping.sourceSymbol}`}
                              >
                                Revert
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {revertOpen ? (
                          <tr key={`${key}-revert`} className="border-t border-red-200 bg-red-50/70">
                            <td colSpan={7} className="px-3 py-3">
                              <div className="grid gap-3 md:grid-cols-[1fr_minmax(260px,360px)_auto] md:items-center">
                                <div>
                                  <div className="text-sm font-semibold text-red-900">Revert durable mapping</div>
                                  <div className="text-xs text-red-800">This removes {mapping.sourceSymbol} -&gt; {mapping.resolvedSymbol}. Type <span className="font-mono">{phrase}</span> to continue.</div>
                                </div>
                                <input
                                  className="min-h-10 rounded-md border border-red-300 bg-white px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-red-500"
                                  value={revertConfirmation}
                                  onChange={(event) => setRevertConfirmation(event.target.value)}
                                  placeholder={phrase}
                                  title="Typed confirmation must exactly match the revert phrase."
                                  data-testid={`provider-console-mapping-revert-confirmation-${mapping.sourceSymbol}`}
                                />
                                <Button
                                  variant="destructive"
                                  disabled={!revertReady || busyAction !== null}
                                  title={revertReady ? "Create a revert mapping provider operation." : "Execute revert is disabled until the typed confirmation matches."}
                                  onClick={() => onRevertMapping(mapping, revertConfirmation.trim())}
                                  data-testid={`provider-console-mapping-revert-execute-${mapping.sourceSymbol}`}
                                >
                                  Execute revert
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={limit} total={total} onPageChange={onPageChange} />
          </>
        ) : evidenceRows.length > 0 ? (
          <DataTable
            data-testid="provider-console-mappings-table"
            data={evidenceRows}
            columns={evidenceColumns}
            rowKey={(row) => `${row.symbol}-${row.providerSymbol}-${row.candidateSymbol ?? "none"}`}
          />
        ) : (
          <Reason tone="info" title="No verified mappings loaded" body="Run Repair preview or open a completed operation to inspect KR mapping evidence." />
        )
      ) : (
        <Reason tone="info" title={`Mappings unavailable for ${selectedProviderId}`} body={capability.emptyMappingReason} />
      )}
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function Reason({ tone, title, body }: { tone: "info" | "warning" | "danger"; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm">
      <span
        className={cn(
          "mt-1 h-3.5 w-3.5 rounded-full",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-orange-500",
          tone === "info" && "bg-primary",
        )}
        aria-hidden="true"
      />
      <span>
        <strong className="text-foreground">{title}</strong>
        <span className="mt-1 block text-muted-foreground">{body}</span>
      </span>
    </div>
  );
}

function SettingReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function HelpList() {
  return (
    <dl className="mt-3 space-y-3 text-sm">
      <SettingReadout label="Repair" value={actionHelp.repair} />
      <SettingReadout label="Renew" value={actionHelp.renew} />
      <SettingReadout label="Rerun" value={actionHelp.rerun} />
      <SettingReadout label="Quote-first" value={resolverModeHelp.quote_first} />
      <SettingReadout label="Chart-probe" value={resolverModeHelp.chart_probe_v1} />
    </dl>
  );
}

function ActionPanel({
  title,
  body,
  enabled,
  disabledReason,
  actionLabel,
  onClick,
  busy,
  testId,
}: {
  title: string;
  body: string;
  enabled: boolean;
  disabledReason: string;
  actionLabel: string;
  onClick?: () => void;
  busy?: boolean;
  testId?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" title={enabled ? body : disabledReason}>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
      <Button className="mt-3 w-full" variant={enabled ? "default" : "secondary"} disabled={!enabled || busy} onClick={onClick} title={enabled ? body : disabledReason} data-testid={testId}>
        {actionLabel}
      </Button>
      {!enabled ? <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p> : null}
    </div>
  );
}
