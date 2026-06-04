"use client";

import { useEffect, useMemo, useState } from "react";
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
  initialUnresolvedState?: ProviderUnresolvedItemDto["state"];
  initialUnresolvedSearch?: string;
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

const phaseTone: Record<ProviderFixerDashboardOperationDto["phase"], string> = {
  diagnose: "bg-slate-100 text-slate-700",
  preview: "bg-sky-100 text-sky-700",
  staged: "bg-amber-100 text-amber-800",
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

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function statusCopy(status: ProviderHealthStatus): string {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "down") return "Down";
  return "Awaiting action";
}

function statusHelp(status: ProviderHealthStatus): string {
  if (status === "healthy") return "Healthy: provider checks are passing and no admin fixer action is currently required.";
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

function StatusBadge({ status, providerId }: { status: ProviderHealthStatus; providerId: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "healthy" && "bg-emerald-100 text-emerald-800",
        status === "degraded" && "bg-amber-100 text-amber-800",
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
  const providerOperations = operations.filter((operation) => operation.providerId === selectedProviderId);
  const providerStagedOperation = stagedOperation?.providerId === selectedProviderId ? stagedOperation : null;
  const selectedOperation =
    providerOperations.find((operation) => operation.id === selectedOperationId)
    ?? providerStagedOperation
    ?? providerOperations[0]
    ?? null;
  const progressOperation =
    providerOperations.find((operation) => operation.phase === "running")
    ?? providerOperations.find((operation) => operation.phase === "paused")
    ?? selectedOperation;
  const currentPreview = selectedOperation?.preview ?? null;
  const typedConfirmationRequired = currentPreview?.confirmationMode === "typed";
  const executeDisabled =
    busyAction !== null
    || !selectedOperation?.canExecute
    || !confirmationChecked
    || (typedConfirmationRequired && typedConfirmation.trim() !== currentPreview?.confirmationText);

  useEffect(() => {
    if (selectedProvider && selectedProvider.providerId === selectedProviderId) return;
    setSelectedProviderId(pickInitialProvider(providers));
  }, [providers, selectedProvider, selectedProviderId]);

  useEffect(() => {
    if (providerOperations.some((operation) => operation.id === selectedOperationId)) return;
    setSelectedOperationId(providerStagedOperation?.id ?? providerOperations[0]?.id ?? "");
  }, [providerOperations, providerStagedOperation, selectedOperationId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEventStream({
    eventTypes: [
      "provider_operation_progress",
      "provider_operation_phase_changed",
      "provider_unresolved_item_changed",
      "provider_incident_changed",
      "provider_budget_wait_changed",
    ],
    onEvent: () => router.refresh(),
    enabled: true,
  });

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
    router.push(`/admin/providers?providerId=${encodeURIComponent(providerId)}&tab=${encodeURIComponent(nextTab)}`);
  }

  function refreshData(): void {
    setToast({ title: "Refreshing provider data", body: "Reloading console state from the API. No upstream provider calls are made." });
    router.refresh();
    window.setTimeout(() => setToast({ title: "Refresh complete", body: "Provider console data was refreshed from local API state." }), 500);
  }

  async function runAction(actionName: string, action: () => Promise<unknown>): Promise<void> {
    setBusyAction(actionName);
    setActionError(null);
    try {
      await action();
      setToast({ title: "Provider operation updated", body: "The operation state changed. Refreshing console data." });
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Provider operation failed.";
      setActionError(message);
      setToast({ title: "Provider operation failed", body: message });
    } finally {
      setBusyAction(null);
    }
  }

  function previewRepair(): void {
    const row = fallbackDiagnosis;
    if (!row) return;
    void runAction("preview", () =>
      postJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/preview`, {
        resolverMode: diagnostics.resolverMode,
        errorCode: row.errorCode,
      }),
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

  function applyUnresolvedFilters(next: {
    state?: ProviderUnresolvedItemDto["state"];
    search?: string;
    page?: number;
  }): void {
    const params = new URLSearchParams({
      providerId: selectedProviderId,
      tab: "unresolved",
      resolverMode: diagnostics.resolverMode,
      errorCode: fallbackDiagnosis?.errorCode ?? diagnostics.errorCode,
      unresolvedState: next.state ?? initialUnresolvedState,
      unresolvedPage: String(next.page ?? 1),
    });
    const search = next.search ?? initialUnresolvedSearch;
    if (search.trim()) params.set("unresolvedSearch", search.trim());
    router.push(`/admin/providers?${params.toString()}`);
  }

  function selectOperation(operationId: string): void {
    setSelectedOperationId(operationId);
    const params = new URLSearchParams({
      providerId: selectedProviderId,
      tab: "operations",
      operationId,
    });
    router.push(`/admin/providers?${params.toString()}`);
  }

  function applyOperationsPage(page: number): void {
    const params = new URLSearchParams({
      providerId: selectedProviderId,
      tab: "operations",
      operationsPage: String(page),
    });
    if (selectedOperation?.id) params.set("operationId", selectedOperation.id);
    router.push(`/admin/providers?${params.toString()}`);
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
            onClick={() => selectOperation(row.id)}
            data-testid={`provider-console-operation-select-${row.id}`}
          >
            Select
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
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="provider-console-page">
      <aside className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="provider-console-rail">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Provider console</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Grouped by market domain and shared budget.</p>
        </div>
        {groups.map((group) => (
          <section key={group.label} className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>{group.label}</span>
              <span className="rounded-full bg-muted px-2 py-1 normal-case tracking-normal">{group.budgetLabel}</span>
            </div>
            {group.providers.map((provider) => {
              const diagnosis = diagnostics.rows.find((row) => row.providerId === provider.providerId);
              const activeOperationCount = operations.filter((operation) =>
                operation.providerId === provider.providerId && ["preview", "staged", "running", "paused"].includes(operation.phase)
              ).length;
              return (
                <button
                  key={provider.providerId}
                  type="button"
                  onClick={() => selectProvider(provider.providerId)}
                  title={`${provider.providerId}: ${statusCopy(provider.status)}. ${diagnosis?.unresolvedCount ?? provider.errorCount7d} unresolved, ${activeOperationCount} active operations.`}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition",
                    provider.providerId === selectedProviderId
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-transparent hover:border-border hover:bg-muted/40",
                  )}
                  data-testid={`provider-console-tab-${provider.providerId}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-foreground">{provider.providerId}</span>
                    <StatusBadge status={provider.status} providerId={provider.providerId} />
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

      <main className="min-w-0 space-y-4">
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
                      {provider.providerId} - {statusCopy(provider.status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button variant="secondary" onClick={refreshData} data-testid="provider-console-refresh" title={actionHelp.refresh}>
                Refresh data
              </Button>
              <Button variant="secondary" disabled={!capability.supportsRenew} title={renewDisabledReason ?? actionHelp.renew}>
                Renew evidence
              </Button>
              <Button onClick={previewRepair} disabled={!capability.supportsRepair || busyAction !== null} title={repairDisabledReason ?? actionHelp.repair}>
                Repair selected
              </Button>
            </div>
          </div>

          <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Provider console tabs">
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
                onClick={() => setActiveTab(tab.id)}
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
            selectedProvider={selectedProvider}
            selectedProviderId={selectedProviderId}
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
            currentPreview={currentPreview}
            capability={capability}
            rerunDisabledReason={rerunDisabledReason}
            onPreviewRepair={previewRepair}
            onSetState={updateUnresolvedItemState}
            onApplyFilters={applyUnresolvedFilters}
            busyAction={busyAction}
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
            currentPreview={currentPreview}
            selectedOperation={selectedOperation}
            confirmationChecked={confirmationChecked}
            typedConfirmation={typedConfirmation}
            typedConfirmationRequired={typedConfirmationRequired}
            executeDisabled={executeDisabled}
            busyAction={busyAction}
            actionError={actionError}
            setConfirmationChecked={setConfirmationChecked}
            setTypedConfirmation={setTypedConfirmation}
            onPreviewRepair={previewRepair}
            onExecute={executeSelectedOperation}
          />
        ) : null}

        {activeTab === "operations" ? (
          <OperationsTab
            operations={providerOperations.length > 0 ? providerOperations : operations}
            operationColumns={operationColumns}
            selectedOperation={selectedOperation}
            selectedProviderId={selectedProviderId}
            onOpenLogs={(operationId) => router.push(`/admin/providers?providerId=${encodeURIComponent(selectedProviderId)}&tab=logs&operationId=${encodeURIComponent(operationId)}`)}
            onOpenUnresolved={() => router.push(`/admin/providers?providerId=${encodeURIComponent(selectedProviderId)}&tab=unresolved&unresolvedState=active`)}
            onPageChange={applyOperationsPage}
            progressOperation={progressOperation}
            outcomes={operationOutcomes.filter((outcome) => outcome.providerId === selectedProviderId)}
            outcomeSummary={operationOutcomeSummary}
            outcomesPage={operationOutcomesPage}
            outcomesLimit={operationOutcomesLimit}
            outcomesTotal={operationOutcomesTotal}
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
            currentPreview={currentPreview}
            evidenceColumns={evidenceColumns}
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
  selectedProvider,
  selectedProviderId,
  diagnosis,
  summary,
  guardrails,
  capability,
  onViewUnresolved,
}: {
  selectedProvider: ProviderHealthStatusDto | null;
  selectedProviderId: string;
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
          <Metric label="Health" value={selectedProvider ? statusCopy(selectedProvider.status) : "Unknown"} detail="Availability plus admin workflow state." />
          <Metric label="Active unresolved" value={formatNumber(diagnosis?.unresolvedCount ?? 0)} detail="From provider console diagnostics until durable unresolved rows are fully migrated." />
          <Metric label="Operations" value={formatNumber(summary.activeOperationsCount)} detail={`${formatNumber(summary.runningOperationsCount)} running, ${formatNumber(summary.queuedOperationsCount)} queued.`} />
        </div>
        <Card className="space-y-3 px-4 py-4 hover:translate-y-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Why this status?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Health combines provider availability, unresolved backlog, rate-limit pressure, and active operations.
              </p>
            </div>
            <Button variant="secondary" onClick={onViewUnresolved}>View unresolved</Button>
          </div>
          <Reason tone="warning" title="Unresolved backlog" body={`${formatNumber(diagnosis?.unresolvedCount ?? 0)} active rows are visible for ${selectedProviderId}.`} />
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
  currentPreview,
  capability,
  rerunDisabledReason,
  onPreviewRepair,
  onSetState,
  onApplyFilters,
  busyAction,
}: {
  selectedProviderId: string;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  unresolvedItems: ProviderUnresolvedItemDto[];
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedTotal: number;
  initialState: ProviderUnresolvedItemDto["state"];
  initialSearch: string;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  capability: ProviderOperationCapabilityDto;
  rerunDisabledReason: string;
  onPreviewRepair: () => void;
  onSetState: (item: ProviderUnresolvedItemDto, state: "active" | "unsupported" | "ignored") => void;
  onApplyFilters: (next: { state?: ProviderUnresolvedItemDto["state"]; search?: string; page?: number }) => void;
  busyAction: string | null;
}) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [stateInput, setStateInput] = useState<ProviderUnresolvedItemDto["state"]>(initialState);
  const evidence = currentPreview?.evidenceSample ?? [];
  const rows = unresolvedItems.length > 0
    ? unresolvedItems.map((item) => ({
        key: `${item.providerId}-${item.marketCode}-${item.errorCode}-${item.sourceSymbol}`,
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
  const canMarkUnsupported = actionSupported(capability, "mark_unsupported");
  const canIgnore = actionSupported(capability, "ignore_unresolved");
  const canReopen = actionSupported(capability, "reopen_unresolved");
  const lifecycleUnavailable = "Available for durable unresolved rows only.";
  const firstDurableRow = rows.find((row) => row.item)?.item ?? null;
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
          <Button variant="secondary" title="Export the currently filtered unresolved rows for offline review.">Export</Button>
          <Button disabled={!capability.supportsRepair} onClick={onPreviewRepair} title={capability.supportsRepair ? actionHelp.repair : "Repair is unavailable for this provider."}>Repair selected</Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px_160px]">
        <input
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApplyFilters({ state: stateInput, search: searchInput, page: 1 });
          }}
          placeholder="Search symbol, provider symbol, error"
          data-testid="provider-console-unresolved-search"
        />
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          value={stateInput}
          onChange={(event) => setStateInput(event.target.value as ProviderUnresolvedItemDto["state"])}
          data-testid="provider-console-unresolved-state"
        >
          <option value="active">State: active</option>
          <option value="resolved">State: resolved</option>
          <option value="unsupported">State: unsupported</option>
          <option value="ignored">State: ignored</option>
        </select>
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm">Error: {diagnosis?.errorCode ?? "all"}</div>
        <Button variant="secondary" onClick={() => onApplyFilters({ state: stateInput, search: searchInput, page: 1 })} data-testid="provider-console-unresolved-apply">
          Apply filters
        </Button>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800" data-testid="provider-console-selection-banner">
        <strong>{formatNumber(Math.min(rows.length, 3))} rows selected.</strong> Select all {formatNumber(unresolvedTotal || diagnosis?.unresolvedCount || 0)} matching rows for bulk repair.
      </div>
      {rows.length > 0 ? (
        <div className="grid gap-3 sm:hidden">
          {rows.map((row) => (
            <article key={row.key} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-foreground">{row.sourceSymbol}</p>
                  <p className="text-xs text-muted-foreground">{row.providerSymbol}</p>
                </div>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{row.stateLabel}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <SettingReadout label="Candidate" value={row.candidateSymbol ?? "-"} />
                <SettingReadout label="Evidence" value={row.evidence ?? "-"} />
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" title={actionHelp.renew}>Renew</Button>
                <Button size="sm" disabled={!capability.supportsRepair} title={capability.supportsRepair ? actionHelp.repair : "Repair is unavailable for this provider."}>Repair</Button>
                <Button size="sm" variant="secondary" disabled title={rerunDisabledReason}>Rerun</Button>
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
              <p className="mt-2 text-xs text-muted-foreground">Rerun is disabled until this item is resolved or mapped.</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          No active durable unresolved rows found for this provider. Run Renew to refresh evidence or check Logs for raw occurrences.
        </div>
      )}
      <div className="hidden overflow-hidden rounded-xl border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" defaultChecked aria-label="Select rows" /></th>
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
                <td className="px-3 py-3"><input type="checkbox" defaultChecked aria-label={`Select ${row.sourceSymbol}`} /></td>
                <td className="px-3 py-3 font-mono font-semibold">{row.sourceSymbol}</td>
                <td className="px-3 py-3 font-mono">{row.providerSymbol}</td>
                <td className="px-3 py-3 font-mono">{row.candidateSymbol ?? "-"}</td>
                <td className="px-3 py-3"><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">{row.stateLabel}</span></td>
                <td className="px-3 py-3">{row.evidence ?? row.note}</td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" title={actionHelp.renew}>Renew</Button>
                    <Button size="sm" disabled={!capability.supportsRepair} title={capability.supportsRepair ? actionHelp.repair : "Repair is unavailable for this provider."}>Repair</Button>
                    <Button size="sm" variant="secondary" disabled title={rerunDisabledReason}>Rerun</Button>
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
                  <p className="mt-1 text-right text-xs text-muted-foreground">Rerun requires resolved mapping.</p>
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
        onPageChange={(page) => onApplyFilters({ state: stateInput, search: searchInput, page })}
      />
      {rows.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur sm:hidden"
          data-testid="provider-console-mobile-bottom-actions"
        >
          <div className="mx-auto flex max-w-md items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{formatNumber(rows.length)} visible unresolved</p>
              <p className="truncate text-[11px] text-muted-foreground">{selectedProviderId}</p>
            </div>
            <Button size="sm" disabled={!capability.supportsRepair} onClick={onPreviewRepair} title={capability.supportsRepair ? actionHelp.repair : "Repair is unavailable for this provider."}>Repair</Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!firstDurableRow || !canIgnore || busyAction !== null}
              title={firstDurableRow ? actionHelp.ignore : lifecycleUnavailable}
              onClick={() => firstDurableRow ? onSetState(firstDurableRow, "ignored") : undefined}
            >
              Ignore
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!firstDurableRow || !canMarkUnsupported || busyAction !== null}
              title={firstDurableRow ? actionHelp.markUnsupported : lifecycleUnavailable}
              onClick={() => firstDurableRow ? onSetState(firstDurableRow, "unsupported") : undefined}
            >
              Unsupported
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
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
  currentPreview,
  selectedOperation,
  confirmationChecked,
  typedConfirmation,
  typedConfirmationRequired,
  executeDisabled,
  busyAction,
  actionError,
  setConfirmationChecked,
  setTypedConfirmation,
  onPreviewRepair,
  onExecute,
}: {
  selectedProviderId: string;
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  capability: ProviderOperationCapabilityDto;
  renewDisabledReason: string | null;
  repairDisabledReason: string | null;
  rerunDisabledReason: string;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  selectedOperation: ProviderFixerDashboardOperationDto | null;
  confirmationChecked: boolean;
  typedConfirmation: string;
  typedConfirmationRequired: boolean;
  executeDisabled: boolean;
  busyAction: string | null;
  actionError: string | null;
  setConfirmationChecked: (checked: boolean) => void;
  setTypedConfirmation: (value: string) => void;
  onPreviewRepair: () => void;
  onExecute: () => void;
}) {
  const stagedVisible = !!selectedOperation && (selectedOperation.phase === "preview" || selectedOperation.phase === "staged" || selectedOperation.phase === "running" || selectedOperation.phase === "paused");
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
        <div className="grid gap-3 md:grid-cols-3">
          <ActionPanel title="Renew" body={actionHelp.renew} enabled={capability.supportsRenew} disabledReason={renewDisabledReason ?? ""} actionLabel="Renew evidence" />
          <ActionPanel title="Repair" body={actionHelp.repair} enabled={capability.supportsRepair} disabledReason={repairDisabledReason ?? ""} actionLabel="Preview repair" onClick={onPreviewRepair} busy={busyAction !== null} />
          <ActionPanel title="Rerun" body={actionHelp.rerun} enabled={false} disabledReason={rerunDisabledReason} actionLabel="Rerun disabled" />
        </div>
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
            <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", selectedOperation?.dangerous ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
              {selectedOperation?.dangerous ? "Dangerous" : "Small write"}
            </span>
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
              </dl>
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
            This section appears only after a repair preview is created or an operation is running, paused, completed, or failed.
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
  selectedProviderId,
  onOpenLogs,
  onOpenUnresolved,
  onPageChange,
  progressOperation,
  outcomes,
  outcomeSummary,
  outcomesPage,
  outcomesLimit,
  outcomesTotal,
  page,
  limit,
  total,
}: {
  operations: ProviderFixerDashboardOperationDto[];
  operationColumns: DataTableColumn<ProviderFixerDashboardOperationDto>[];
  selectedOperation: ProviderFixerDashboardOperationDto | null;
  selectedProviderId: string;
  onOpenLogs: (operationId: string) => void;
  onOpenUnresolved: () => void;
  onPageChange: (page: number) => void;
  progressOperation: ProviderFixerDashboardOperationDto | null;
  outcomes: ProviderOperationOutcomeDto[];
  outcomeSummary: ProviderOperationOutcomeSummaryDto;
  outcomesPage: number;
  outcomesLimit: number;
  outcomesTotal: number;
  page: number;
  limit: number;
  total: number;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Provider operations</h3>
          <p className="mt-1 text-sm text-muted-foreground">Operation summaries and durable per-item progress.</p>
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
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
        <h3 className="text-xl font-semibold text-foreground">Live progress</h3>
        {progressOperation ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono text-muted-foreground">{progressOperation.id}</span>
              <span>{operationProgress(progressOperation)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${operationProgress(progressOperation)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Matched" value={formatNumber(progressOperation.matchCount)} detail="Frozen operation scope" />
              <Metric label="Rate cap" value={`${progressOperation.effectiveRateCapPerMinute ?? 250}/min`} detail="Effective provider operation budget" />
              <Metric label="Processed" value={formatNumber(outcomeSummary.processed)} detail={`${formatNumber(outcomeSummary.succeeded)} succeeded, ${formatNumber(outcomeSummary.skipped)} skipped`} />
              <Metric label="Failed" value={formatNumber(outcomeSummary.failed + outcomeSummary.rateLimited)} detail="Failures and rate-limit pauses" />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No running operation.</p>
        )}
      </Card>
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0 xl:col-span-2" data-testid="provider-console-operation-details">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Operation details</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Selected operation context, durable scope, budget state, and related provider-console views.
            </p>
          </div>
          {selectedOperation ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onOpenLogs(selectedOperation.id)} data-testid="provider-console-operation-open-logs">
                Open logs
              </Button>
              <Button size="sm" variant="secondary" onClick={onOpenUnresolved}>
                Open unresolved
              </Button>
            </div>
          ) : null}
        </div>
        {selectedOperation ? (
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Provider" value={selectedProviderId} detail={selectedOperation.market ?? "Provider market"} />
            <Metric label="Phase" value={selectedOperation.phase} detail={selectedOperation.canRetry ? "Retry available" : "Retry unavailable"} />
            <Metric label="Progress" value={`${operationProgress(selectedOperation)}%`} detail={`${formatNumber(outcomeSummary.processed)} processed outcomes`} />
            <Metric label="Rate cap" value={`${selectedOperation.effectiveRateCapPerMinute ?? 250}/min`} detail={`${formatNumber(selectedOperation.autoPauseFailureCount ?? 0)} auto-pause failures`} />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Select an operation to inspect details.</p>
        )}
      </Card>
      <Card className="space-y-4 px-4 py-4 hover:translate-y-0 xl:col-span-2">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Operation item outcomes</h3>
          <p className="mt-1 text-sm text-muted-foreground">Durable token-level results for the selected provider operation.</p>
        </div>
        {outcomes.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
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
                    <td className="px-3 py-3">{outcome.message ?? outcome.errorCode ?? "-"}</td>
                    <td className="px-3 py-3 font-mono text-muted-foreground">{formatTimestamp(outcome.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No item outcomes recorded for this operation yet.</p>
        )}
        <Pagination page={outcomesPage} limit={outcomesLimit} total={outcomesTotal} onPageChange={() => undefined} />
      </Card>
    </div>
  );
}

function IncidentsTab({
  selectedProviderId,
  incidents,
  page,
  limit,
  total,
  onSetStatus,
  busyAction,
}: {
  selectedProviderId: string;
  incidents: ProviderIncidentDto[];
  page: number;
  limit: number;
  total: number;
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
        <div className="overflow-hidden rounded-xl border border-border">
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
                      <div className="mt-1 max-w-[34rem] text-xs text-muted-foreground">{incident.summary ?? incident.incidentKey}</div>
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
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">No open incidents for this provider.</p>
      )}
      <Pagination page={page} limit={limit} total={total} onPageChange={() => undefined} />
    </Card>
  );
}

function ActivityTab({
  selectedProviderId,
  items,
  page,
  limit,
  total,
}: {
  selectedProviderId: string;
  items: ProviderActivityItemDto[];
  page: number;
  limit: number;
  total: number;
}) {
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <h3 className="text-xl font-semibold text-foreground">Activity</h3>
      <p className="text-sm text-muted-foreground">Provider-scoped timeline composed from operations, logs, incidents, unresolved items, and mappings.</p>
      <div className="space-y-0">
        {items.length > 0 ? items.map((entry) => (
          <div key={entry.id} className="grid gap-2 border-b border-border py-3 text-sm last:border-b-0 md:grid-cols-[170px_130px_1fr]">
            <span className="font-mono text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
            <span className="w-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{entry.kind}</span>
            <span><strong>{entry.title}</strong>{entry.detail ? ` - ${entry.detail}` : ""}</span>
          </div>
        )) : (
          <Reason tone="info" title={`No recent activity for ${selectedProviderId}`} body="Activity will populate from provider operation logs, incidents, unresolved items, and mappings." />
        )}
      </div>
      <Pagination page={page} limit={limit} total={total} onPageChange={() => undefined} />
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
      <Pagination page={page} limit={limit} total={total} onPageChange={() => undefined} />
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
  currentPreview,
  evidenceColumns,
}: {
  selectedProviderId: string;
  capability: ProviderOperationCapabilityDto;
  mappings: ProviderResolutionMappingDto[];
  page: number;
  limit: number;
  total: number;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  evidenceColumns: DataTableColumn<NonNullable<ProviderFixerDashboardOperationDto["preview"]>["evidenceSample"][number]>[];
}) {
  const evidenceRows = currentPreview?.evidenceSample ?? [];
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div>
        <h3 className="text-xl font-semibold text-foreground">Mappings</h3>
        <p className="mt-1 text-sm text-muted-foreground">Durable source catalog to provider-symbol bindings where supported.</p>
      </div>
      {capability.supportsMappings ? (
        mappings.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Provider symbol</th>
                    <th className="px-3 py-3">Resolver</th>
                    <th className="px-3 py-3">Verified</th>
                    <th className="px-3 py-3">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={`${mapping.providerId}-${mapping.marketCode}-${mapping.sourceSymbol}`} className="border-t border-border">
                      <td className="px-3 py-3">
                        <div className="font-mono font-semibold text-foreground">{mapping.sourceSymbol}</div>
                        <div className="text-xs text-muted-foreground">{mapping.marketCode}</div>
                      </td>
                      <td className="px-3 py-3 font-mono">{mapping.resolvedSymbol}</td>
                      <td className="px-3 py-3">{mapping.resolverMode?.replace(/_/g, " ") ?? "manual"}</td>
                      <td className="px-3 py-3 font-mono text-muted-foreground">{formatTimestamp(mapping.verifiedAt)}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {mapping.evidence?.candidate ? String(mapping.evidence.candidate) : "Stored durable mapping"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={limit} total={total} onPageChange={() => undefined} />
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

function Reason({ tone, title, body }: { tone: "info" | "warning"; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm">
      <span className={cn("mt-1 h-3.5 w-3.5 rounded-full", tone === "warning" ? "bg-amber-500" : "bg-primary")} aria-hidden="true" />
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
}: {
  title: string;
  body: string;
  enabled: boolean;
  disabledReason: string;
  actionLabel: string;
  onClick?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" title={enabled ? body : disabledReason}>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
      <Button className="mt-3 w-full" variant={enabled ? "default" : "secondary"} disabled={!enabled || busy} onClick={onClick} title={enabled ? body : disabledReason}>
        {actionLabel}
      </Button>
      {!enabled ? <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p> : null}
    </div>
  );
}
