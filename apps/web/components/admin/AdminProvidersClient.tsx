"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
  ProviderHealthStatus,
  ProviderHealthStatusDto,
  ProviderIncidentDto,
  ProviderOperationOutcomeDto,
  ProviderOperationOutcomeSummaryDto,
  ProviderUnresolvedItemDto,
} from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Pagination } from "./Pagination";
import { ApiError, postJson } from "../../lib/api";
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
  initialProviderId?: string;
  initialTab?: ProviderConsoleTab;
  summary: ProviderFixerDashboardSummaryDto;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
  unresolvedItems: ProviderUnresolvedItemDto[];
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedTotal: number;
  incidents: ProviderIncidentDto[];
  incidentsPage: number;
  incidentsLimit: number;
  incidentsTotal: number;
  stagedOperation: ProviderFixerDashboardOperationDto | null;
  operations: ProviderFixerDashboardOperationDto[];
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

const providerCapabilities: Record<string, {
  supportsMappings: boolean;
  supportsRepair: boolean;
  supportsRenew: boolean;
  supportsRerun: boolean;
  supportsResolverModes: boolean;
  emptyMappingReason: string;
}> = {
  "yahoo-finance-kr": {
    supportsMappings: true,
    supportsRepair: true,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: true,
    emptyMappingReason: "No durable KR mappings have been verified yet.",
  },
  "yahoo-finance-au": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "Yahoo Finance AU does not use durable symbol mappings in this console.",
  },
  "finmind-tw": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "FinMind TW has no provider-symbol mapping resolver yet.",
  },
  "finmind-us": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "FinMind US has no provider-symbol mapping resolver yet.",
  },
  "twelve-data-kr": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: false,
    supportsResolverModes: false,
    emptyMappingReason: "Twelve Data KR is catalog evidence for KR bindings; Yahoo KR owns the durable provider mapping.",
  },
  "twelve-data-au": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: false,
    supportsResolverModes: false,
    emptyMappingReason: "Twelve Data AU is catalog metadata only in this console.",
  },
  frankfurter: {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "Frankfurter refreshes FX rates and does not use symbol mappings.",
  },
  "asx-gics-csv": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "ASX GICS CSV enriches catalog classifications and does not use provider-symbol mappings.",
  },
};

const defaultCapability = {
  supportsMappings: false,
  supportsRepair: false,
  supportsRenew: true,
  supportsRerun: false,
  supportsResolverModes: false,
  emptyMappingReason: "This provider does not expose durable mappings yet.",
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

function disabledReason(action: "repair" | "rerun", supportsAction: boolean): string | null {
  if (!supportsAction && action === "repair") return "Repair is unavailable because this provider has no mapping resolver.";
  if (!supportsAction && action === "rerun") return "Rerun is unavailable for this provider or plan.";
  if (action === "rerun") return "Rerun requires resolved items or durable provider mappings.";
  return null;
}

export function AdminProvidersClient({
  providers,
  initialProviderId,
  initialTab,
  summary,
  guardrails,
  diagnostics,
  unresolvedItems,
  unresolvedPage,
  unresolvedLimit,
  unresolvedTotal,
  incidents,
  incidentsPage,
  incidentsLimit,
  incidentsTotal,
  stagedOperation,
  operations,
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
  const [selectedOperationId, setSelectedOperationId] = useState(stagedOperation?.id ?? operations[0]?.id ?? "");
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  const selectedProvider = providers.find((provider) => provider.providerId === selectedProviderId) ?? providers[0] ?? null;
  const capability = providerCapabilities[selectedProviderId] ?? defaultCapability;
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

  function mutateOperation(operationId: string, action: "pause" | "resume" | "cancel"): void {
    void runAction(action, () =>
      postJson(`/admin/providers/${encodeURIComponent(selectedProviderId)}/operations/${encodeURIComponent(operationId)}/${action}`, {}),
    );
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
          <Button size="sm" variant={selectedOperation?.id === row.id ? "default" : "secondary"} onClick={() => setSelectedOperationId(row.id)}>
            Select
          </Button>
          {row.canPause ? <Button size="sm" variant="ghost" onClick={() => mutateOperation(row.id, "pause")}>Pause</Button> : null}
          {row.canResume ? <Button size="sm" variant="ghost" onClick={() => mutateOperation(row.id, "resume")}>Resume</Button> : null}
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
            </div>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button variant="secondary" onClick={refreshData} data-testid="provider-console-refresh">
                Refresh data
              </Button>
              <Button variant="secondary" disabled={!capability.supportsRenew} title={!capability.supportsRenew ? "Renew is not supported by this provider." : "Refresh evidence and candidates without writing mappings or bars."}>
                Renew evidence
              </Button>
              <Button onClick={previewRepair} disabled={!capability.supportsRepair || busyAction !== null} title={disabledReason("repair", capability.supportsRepair) ?? "Bind provider symbols for unresolved instruments."}>
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
            currentPreview={currentPreview}
            capability={capability}
            onPreviewRepair={previewRepair}
          />
        ) : null}

        {activeTab === "fixer" ? (
          <FixerTab
            selectedProviderId={selectedProviderId}
            diagnostics={diagnostics}
            diagnosis={fallbackDiagnosis}
            guardrails={guardrails}
            capability={capability}
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
          />
        ) : null}

        {activeTab === "activity" ? (
          <ActivityTab selectedProviderId={selectedProviderId} logs={logs} />
        ) : null}

        {activeTab === "logs" ? (
          <LogsTab
            logs={logs}
            page={logsPage}
            limit={logsLimit}
            total={logsTotal}
            selectedProviderId={selectedProviderId}
          />
        ) : null}

        {activeTab === "mappings" ? (
          <MappingsTab
            selectedProviderId={selectedProviderId}
            capability={capability}
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
  capability: typeof defaultCapability;
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
  currentPreview,
  capability,
  onPreviewRepair,
}: {
  selectedProviderId: string;
  diagnosis: ProviderFixerDashboardDiagnosticsDto["rows"][number] | null;
  unresolvedItems: ProviderUnresolvedItemDto[];
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedTotal: number;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  capability: typeof defaultCapability;
  onPreviewRepair: () => void;
}) {
  const evidence = currentPreview?.evidenceSample ?? [];
  const rows = unresolvedItems.length > 0
    ? unresolvedItems.map((item) => ({
        key: `${item.providerId}-${item.marketCode}-${item.errorCode}-${item.sourceSymbol}`,
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
        sourceSymbol: item.symbol,
        providerSymbol: item.providerSymbol,
        candidateSymbol: item.candidateSymbol,
        state: "active",
        stateLabel: item.verificationStatus === "verified" ? "candidate found" : item.verificationStatus,
        evidence: item.exchangeHint ?? item.note,
        note: item.note,
      }));
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
          <Button variant="secondary">Export</Button>
          <Button disabled={!capability.supportsRepair} onClick={onPreviewRepair}>Repair selected</Button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px_160px]">
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-muted-foreground">Search symbol, provider symbol, instrument id</div>
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm">State: active</div>
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm">Error: {diagnosis?.errorCode ?? "all"}</div>
        <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm">Provider: {selectedProviderId}</div>
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
                <Button size="sm" variant="secondary">Renew</Button>
                <Button size="sm" disabled={!capability.supportsRepair}>Repair</Button>
                <Button size="sm" variant="secondary" disabled title={disabledReason("rerun", capability.supportsRerun) ?? undefined}>Rerun</Button>
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
                    <Button size="sm" variant="secondary">Renew</Button>
                    <Button size="sm" disabled={!capability.supportsRepair}>Repair</Button>
                    <Button size="sm" variant="secondary" disabled title={disabledReason("rerun", capability.supportsRerun) ?? undefined}>Rerun</Button>
                  </div>
                  <p className="mt-1 text-right text-xs text-muted-foreground">Rerun requires resolved mapping.</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={unresolvedPage} limit={unresolvedLimit} total={unresolvedTotal} onPageChange={() => undefined} />
    </Card>
  );
}

function FixerTab({
  selectedProviderId,
  diagnostics,
  diagnosis,
  guardrails,
  capability,
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
  capability: typeof defaultCapability;
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
              <span className={cn("px-3 py-2", diagnostics.resolverMode === "quote_first" ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground")}>Quote-first</span>
              <span className={cn("border-l border-border px-3 py-2", diagnostics.resolverMode === "chart_probe_v1" ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground")}>Chart-probe</span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Active unresolved" value={formatNumber(diagnosis?.unresolvedCount ?? 0)} detail={diagnosis?.errorCode ?? "No active error code"} />
          <Metric label="Guardrail threshold" value={formatNumber(guardrails.dangerousMatchThreshold)} detail="Bulk writes above this require typed phrase." />
          <Metric label="Preview sample" value={formatNumber(guardrails.previewSampleLimit)} detail="Rows shown before dangerous execution." />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ActionPanel title="Renew" body="Refresh evidence and candidates; does not write mappings or bars." enabled={capability.supportsRenew} disabledReason="Renew is unavailable for this provider." actionLabel="Renew evidence" />
          <ActionPanel title="Repair" body="Bind provider symbols for unresolved instruments." enabled={capability.supportsRepair} disabledReason={disabledReason("repair", capability.supportsRepair) ?? ""} actionLabel="Preview repair" onClick={onPreviewRepair} busy={busyAction !== null} />
          <ActionPanel title="Rerun" body="Fetch fresh provider data for already resolved mappings." enabled={false} disabledReason={disabledReason("rerun", capability.supportsRerun) ?? ""} actionLabel="Rerun disabled" />
        </div>
        {actionError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p> : null}
      </Card>

      {stagedVisible ? (
        <Card className="space-y-4 px-4 py-4 hover:translate-y-0" data-testid="provider-console-operation-panel">
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
                <Button variant="secondary" onClick={onPreviewRepair}>Refresh preview</Button>
                <Button disabled={executeDisabled} onClick={onExecute} data-testid="provider-console-execute-button">Execute operation</Button>
              </div>
            </>
          ) : null}
        </Card>
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
        <Pagination page={page} limit={limit} total={total} onPageChange={() => undefined} />
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
}: {
  selectedProviderId: string;
  incidents: ProviderIncidentDto[];
  page: number;
  limit: number;
  total: number;
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
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
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
                </tr>
              ))}
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

function ActivityTab({ selectedProviderId, logs }: { selectedProviderId: string; logs: ProviderFixerDashboardLogEntryDto[] }) {
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <h3 className="text-xl font-semibold text-foreground">Activity</h3>
      <p className="text-sm text-muted-foreground">Provider-scoped timeline composed from operations, logs, incidents, unresolved items, audit events, and settings changes.</p>
      <div className="space-y-0">
        {logs.length > 0 ? logs.map((entry) => (
          <div key={entry.id} className="grid gap-2 border-b border-border py-3 text-sm last:border-b-0 md:grid-cols-[170px_1fr]">
            <span className="font-mono text-muted-foreground">{formatTimestamp(entry.occurredAt)}</span>
            <span><strong>{entry.phase}</strong> {entry.message}</span>
          </div>
        )) : (
          <Reason tone="info" title={`No recent activity for ${selectedProviderId}`} body="Activity will populate from provider operation logs and incident timeline events." />
        )}
      </div>
    </Card>
  );
}

function LogsTab({
  logs,
  page,
  limit,
  total,
  selectedProviderId,
}: {
  logs: ProviderFixerDashboardLogEntryDto[];
  page: number;
  limit: number;
  total: number;
  selectedProviderId: string;
}) {
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Logs</h3>
          <p className="mt-1 text-sm text-muted-foreground">Raw/system diagnostics for {selectedProviderId}. Purge preview is destructive and typed-confirmed in the backend slice.</p>
        </div>
        <Button variant="destructive" disabled title="Purge preview API is part of the provider-scoped backend slice.">Purge logs</Button>
      </div>
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
  currentPreview,
  evidenceColumns,
}: {
  selectedProviderId: string;
  capability: typeof defaultCapability;
  currentPreview: ProviderFixerDashboardOperationDto["preview"] | null;
  evidenceColumns: DataTableColumn<NonNullable<ProviderFixerDashboardOperationDto["preview"]>["evidenceSample"][number]>[];
}) {
  const rows = currentPreview?.evidenceSample ?? [];
  return (
    <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
      <div>
        <h3 className="text-xl font-semibold text-foreground">Mappings</h3>
        <p className="mt-1 text-sm text-muted-foreground">Durable source catalog to provider-symbol bindings where supported.</p>
      </div>
      {capability.supportsMappings ? (
        rows.length > 0 ? (
          <DataTable
            data-testid="provider-console-mappings-table"
            data={rows}
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
      <SettingReadout label="Repair" value="Bind provider symbols for unresolved instruments." />
      <SettingReadout label="Renew" value="Refresh evidence and candidates; no mappings or bars." />
      <SettingReadout label="Rerun" value="Fetch fresh provider data for already resolved mappings." />
      <SettingReadout label="Quote-first" value="Try quote metadata before chart calls; cheaper default." />
      <SettingReadout label="Chart-probe" value="Use chart requests to verify backfill readiness; costs more budget." />
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
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
      <Button className="mt-3 w-full" variant={enabled ? "default" : "secondary"} disabled={!enabled || busy} onClick={onClick} title={!enabled ? disabledReason : undefined}>
        {actionLabel}
      </Button>
      {!enabled ? <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p> : null}
    </div>
  );
}
