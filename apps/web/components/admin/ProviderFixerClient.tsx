"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
} from "@vakwen/shared-types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Pagination } from "./Pagination";
import { cn } from "../../lib/utils";
import { ApiError, postJson } from "../../lib/api";

const t = {
  pageTitle: "Provider fixer",
  pageDescription:
    "Repair and re-run stale provider coverage with guarded bulk controls and operator audit.",
  refreshLabel: "Refresh resolver stats",
  auditLabel: "Open audit timeline",
  criticalUnresolved: "Critical unresolved",
  activeOperations: "Active operations",
  guardrailStatus: "Guardrail status",
  guardrailEnabled: "ENABLED",
  guardrailDescription: "Auto-pause, caps, and preview enforced",
  diagnosisTitle: "Provider scan / diagnosis",
  diagnosisDescription: "Resolver mode, unresolved trend, and queued item counts.",
  unresolvedListLabel: "View unresolved list",
  dangerRuleTitle: "Danger level rule:",
  modeLabel: "Mode",
  resolverLabel: "Resolver",
  errorCodeLabel: "Error code",
  stageRepairLabel: "Stage resolver repair",
  saveDraftLabel: "Save as draft operation",
  mappingLabel: "Show KR resolver audit mapping",
  stageTitle: "Staged provider operation",
  stageDescription: "Safe mode default + explicit operator confirmation.",
  dangerousLabel: "Dangerous",
  standardLabel: "Standard confirm",
  runDiagnosticsLabel: "Run diagnostics",
  executeLabel: "Execute",
  pauseLabel: "Pause",
  resumeLabel: "Resume",
  cancelLabel: "Cancel",
  previewTokenLabel: "Preview token",
  runningProgressLabel: "Running operation progress",
  evidenceTitle: "KR binding evidence sample",
  logsTitle: "Operator log preview (last 24h)",
  confirmationLabel: "I understand this can write provider rows",
  typedConfirmLabel: "Type the confirmation string to unlock execution",
  providerLabel: "Provider",
  marketLabel: "Market",
  unresolvedLabel: "Unresolved",
  resolverStatusLabel: "Resolver",
  actionLabel: "Action",
  operationLabel: "Operation",
  phaseLabel: "Phase",
  matchLabel: "Match",
  previewLabel: "Preview",
  actionsLabel: "Actions",
  symbolLabel: "Symbol",
  providerSymbolLabel: "Provider symbol",
  candidateLabel: "Candidate",
  evidenceLabel: "Evidence",
  verificationLabel: "Verification",
  noteLabel: "Note",
  noLogs: "No operator log entries yet.",
  noEvidence: "No KR evidence sample available for the current preview.",
  noOperations: "No provider operations found for the current scope.",
  recommendationPrefix: "Current recommendation:",
  queryBackedNote: "Scope is currently query-backed due to large volume.",
  actionFailed: "Provider fixer action failed.",
};

const noop = () => undefined;

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

interface ProviderFixerClientProps {
  summary: ProviderFixerDashboardSummaryDto;
  guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  diagnostics: ProviderFixerDashboardDiagnosticsDto;
  stagedOperation: ProviderFixerDashboardOperationDto | null;
  operations: ProviderFixerDashboardOperationDto[];
  operationsPage: number;
  operationsLimit: number;
  operationsTotal: number;
  logs: ProviderFixerDashboardLogEntryDto[];
  logsPage: number;
  logsLimit: number;
  logsTotal: number;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatPreviewSummary(operation: ProviderFixerDashboardOperationDto): string {
  return `sample: ${formatNumber(operation.preview.sampleCount)} / ${formatNumber(operation.preview.matchCount)}`;
}

function guardrailChipClass(dangerous: boolean): string {
  return dangerous
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function severityDotClass(severity: ProviderFixerDashboardDiagnosticsDto["rows"][number]["severity"]): string {
  if (severity === "critical") return "bg-rose-500";
  if (severity === "warning") return "bg-amber-500";
  return "bg-emerald-500";
}

function scopeSummary(operation: ProviderFixerDashboardOperationDto): string {
  const parts = [operation.providerId];
  if (operation.market) parts.push(`market=${operation.market}`);
  parts.push(operation.preview.scopeLabel);
  return parts.join(" / ");
}

export function ProviderFixerClient({
  summary,
  guardrails,
  diagnostics,
  stagedOperation,
  operations,
  operationsPage,
  operationsLimit,
  operationsTotal,
  logs,
  logsPage,
  logsLimit,
  logsTotal,
}: ProviderFixerClientProps) {
  const router = useRouter();
  const [resolverMode, setResolverMode] = useState(diagnostics.resolverMode);
  const [providerId, setProviderId] = useState(diagnostics.providerId);
  const [errorCode, setErrorCode] = useState(diagnostics.errorCode);
  const [selectedOperationId, setSelectedOperationId] = useState(
    stagedOperation?.id ?? operations[0]?.id ?? "",
  );
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedOperationId) {
      const match = operations.find((operation) => operation.id === selectedOperationId);
      if (match) return;
    }
    setSelectedOperationId(stagedOperation?.id ?? operations[0]?.id ?? "");
  }, [operations, selectedOperationId, stagedOperation]);

  const selectedOperation =
    operations.find((operation) => operation.id === selectedOperationId) ??
    stagedOperation ??
    operations[0] ??
    null;
  const progressOperation =
    operations.find((operation) => operation.phase === "running") ??
    operations.find((operation) => operation.phase === "paused") ??
    selectedOperation;
  const currentPreview = selectedOperation?.preview ?? null;
  const typedConfirmationRequired = currentPreview?.confirmationMode === "typed";
  const confirmationSatisfied =
    confirmationChecked &&
    (!typedConfirmationRequired || typedConfirmation.trim() === currentPreview?.confirmationText);
  const executeDisabled = busyAction !== null || !selectedOperation?.canExecute || !confirmationSatisfied;

  async function runProviderFixerAction(actionName: string, action: () => Promise<unknown>): Promise<void> {
    setBusyAction(actionName);
    setActionError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : t.actionFailed;
      setActionError(message);
    } finally {
      setBusyAction(null);
    }
  }

  function startPreview(): void {
    void runProviderFixerAction("preview", () =>
      postJson("/admin/provider-fixer/preview", {
        providerId,
        resolverMode,
        errorCode,
      }),
    );
  }

  function executeSelectedOperation(): void {
    if (!selectedOperation || !currentPreview) return;
    void runProviderFixerAction("execute", () =>
      postJson(`/admin/provider-fixer/operations/${encodeURIComponent(selectedOperation.id)}/execute`, {
        previewToken: currentPreview.token,
        acknowledged: confirmationChecked,
        typedConfirmation: typedConfirmation.trim(),
      }),
    );
  }

  function mutateOperation(operationId: string, action: "pause" | "resume" | "cancel"): void {
    void runProviderFixerAction(action, () =>
      postJson(`/admin/provider-fixer/operations/${encodeURIComponent(operationId)}/${action}`, {}),
    );
  }

  const diagnosisColumns: DataTableColumn<ProviderFixerDashboardDiagnosticsDto["rows"][number]>[] = [
    {
      key: "provider",
      header: t.providerLabel,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", severityDotClass(row.severity))} aria-hidden="true" />
          <span>{row.providerId}</span>
        </span>
      ),
    },
    { key: "market", header: t.marketLabel, render: (row) => row.market },
    { key: "unresolved", header: t.unresolvedLabel, render: (row) => formatNumber(row.unresolvedCount) },
    { key: "resolver", header: t.resolverStatusLabel, render: (row) => row.resolverStatus },
    {
      key: "action",
      header: t.actionLabel,
      render: (row) => (
        <Button
          size="sm"
          variant={row.providerId === providerId ? "default" : "secondary"}
          onClick={() => setProviderId(row.providerId)}
          data-testid={`provider-fixer-diagnose-${row.providerId}`}
        >
          Diagnose
        </Button>
      ),
    },
  ];

  const operationColumns: DataTableColumn<ProviderFixerDashboardOperationDto>[] = [
    { key: "operation", header: t.operationLabel, render: (row) => row.id },
    {
      key: "phase",
      header: t.phaseLabel,
      render: (row) => (
        <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", phaseTone[row.phase])}>
          {row.phase}
        </span>
      ),
    },
    { key: "match", header: t.matchLabel, render: (row) => formatNumber(row.matchCount) },
    { key: "preview", header: t.previewLabel, render: (row) => formatPreviewSummary(row) },
    {
      key: "actions",
      header: t.actionsLabel,
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          {row.canExecute ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelectedOperationId(row.id)}
              data-testid={`provider-fixer-select-operation-${row.id}`}
            >
              {t.executeLabel}
            </Button>
          ) : null}
          {row.canPause ? (
            <Button size="sm" variant="ghost" disabled={busyAction !== null} onClick={() => mutateOperation(row.id, "pause")}>
              {t.pauseLabel}
            </Button>
          ) : null}
          {row.canResume ? (
            <Button size="sm" variant="ghost" disabled={busyAction !== null} onClick={() => mutateOperation(row.id, "resume")}>
              {t.resumeLabel}
            </Button>
          ) : null}
          {row.canCancel ? (
            <Button
              size="sm"
              variant="outline"
              className="border-rose-200 text-rose-700"
              disabled={busyAction !== null}
              onClick={() => mutateOperation(row.id, "cancel")}
            >
              {t.cancelLabel}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const evidenceColumns: DataTableColumn<NonNullable<typeof currentPreview>["evidenceSample"][number]>[] = [
    { key: "symbol", header: t.symbolLabel, render: (row) => row.symbol },
    { key: "providerSymbol", header: t.providerSymbolLabel, render: (row) => row.providerSymbol },
    { key: "candidate", header: t.candidateLabel, render: (row) => row.candidateSymbol ?? "—" },
    { key: "evidence", header: t.evidenceLabel, render: (row) => row.exchangeHint ?? "—" },
    { key: "verification", header: t.verificationLabel, render: (row) => row.verificationStatus },
    { key: "note", header: t.noteLabel, render: (row) => row.note },
  ];

  return (
    <div className="space-y-4" data-testid="provider-fixer-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">{t.pageTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t.pageDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => router.refresh()} data-testid="provider-fixer-refresh">
            {t.refreshLabel}
          </Button>
          <Button asChild data-testid="provider-fixer-audit-link">
            <Link href="/admin/audit-log?category=providerHealth">{t.auditLabel}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="px-4 py-4 hover:translate-y-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t.criticalUnresolved}</p>
          <p className="mt-3 text-4xl font-semibold text-foreground" data-testid="provider-fixer-metric-critical">
            {formatNumber(summary.criticalUnresolvedCount)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{summary.affectedProviders.join(", ")}</p>
        </Card>
        <Card className="px-4 py-4 hover:translate-y-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t.activeOperations}</p>
          <p className="mt-3 text-4xl font-semibold text-foreground">{formatNumber(summary.activeOperationsCount)}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatNumber(summary.queuedOperationsCount)} queued, {formatNumber(summary.runningOperationsCount)} in progress
          </p>
        </Card>
        <Card className="px-4 py-4 hover:translate-y-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t.guardrailStatus}</p>
          <p className="mt-3 inline-flex items-center gap-2 text-2xl font-semibold text-foreground">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">
              ✓
            </span>
            {summary.guardrailsEnabled ? t.guardrailEnabled : "DISABLED"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{t.guardrailDescription}</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.12fr_1fr]">
        <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t.diagnosisTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t.diagnosisDescription}</p>
            </div>
            <Button variant="ghost" size="sm">
              {t.unresolvedListLabel}
            </Button>
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            <strong>{t.dangerRuleTitle}</strong> any operation that can alter more than{" "}
            {formatNumber(guardrails.dangerousMatchThreshold)} symbols must use staged execution.
            Preview token required before execute.
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.2fr]">
            <label className="grid gap-1 text-sm text-muted-foreground">
              <span>{t.modeLabel}</span>
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-foreground"
                value={resolverMode}
                onChange={(event) => setResolverMode(event.target.value as ProviderFixerDashboardDiagnosticsDto["resolverMode"])}
                data-testid="provider-fixer-mode-select"
              >
                <option value="quote_first">quote_first (safe default)</option>
                <option value="chart_probe_v1">chart_probe_v1 (repair mode)</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted-foreground">
              <span>{t.resolverLabel}</span>
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-foreground"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                data-testid="provider-fixer-provider-select"
              >
                {diagnostics.rows.map((row) => (
                  <option key={row.providerId} value={row.providerId}>
                    {row.providerId}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted-foreground">
              <span>{t.errorCodeLabel}</span>
              <select
                className="h-10 rounded-lg border border-input bg-background px-3 text-foreground"
                value={errorCode}
                onChange={(event) => setErrorCode(event.target.value)}
                data-testid="provider-fixer-error-code-select"
              >
                <option value={errorCode}>{errorCode}</option>
                {diagnostics.rows
                  .filter((row) => row.errorCode !== errorCode)
                  .map((row) => (
                    <option key={`${row.providerId}-${row.errorCode}`} value={row.errorCode}>
                      {row.errorCode}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <DataTable
            data-testid="provider-fixer-diagnosis-table"
            data={diagnostics.rows}
            columns={diagnosisColumns}
            rowKey={(row) => `${row.providerId}-${row.market}-${row.errorCode}`}
            tableClassName="[&_th]:bg-slate-50/80 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-slate-500"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="border-rose-200 bg-rose-50 text-rose-700"
              disabled={busyAction !== null}
              onClick={startPreview}
            >
              {t.stageRepairLabel}
            </Button>
            <Button variant="ghost">{t.saveDraftLabel}</Button>
            <Button asChild variant="link" className="h-auto px-0 text-slate-500">
              <Link href="/admin/audit-log?category=providerHealth">{t.mappingLabel}</Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            <strong>{t.recommendationPrefix}</strong> {diagnostics.recommendation}
          </p>
          {actionError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {actionError}
            </p>
          ) : null}
        </Card>

        <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{t.stageTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t.stageDescription}</p>
            </div>
            <span
              className={cn(
                "inline-flex rounded-full border px-3 py-1 text-xs font-medium",
                guardrailChipClass(selectedOperation?.dangerous ?? false),
              )}
              data-testid="provider-fixer-danger-badge"
            >
              {selectedOperation?.dangerous ? t.dangerousLabel : t.standardLabel}
            </span>
          </div>

          {selectedOperation ? (
            <>
              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  readOnly
                  value={scopeSummary(selectedOperation)}
                  className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  data-testid="provider-fixer-scope-input"
                />
                <Button variant="secondary" disabled={busyAction !== null} onClick={startPreview}>
                  {t.runDiagnosticsLabel}
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">
                {t.queryBackedNote} Pagination: {currentPreview?.page}/{currentPreview?.totalPages} pages,{" "}
                {guardrails.uiPageSize} rows/page in UI.
              </p>

              <div className="grid gap-3">
                <label className="grid gap-1 text-sm text-muted-foreground">
                  <span>{t.previewTokenLabel}</span>
                  <select
                    className="h-10 rounded-lg border border-input bg-background px-3 text-foreground"
                    value={selectedOperationId}
                    onChange={(event) => {
                      setSelectedOperationId(event.target.value);
                      setConfirmationChecked(false);
                      setTypedConfirmation("");
                    }}
                    data-testid="provider-fixer-operation-select"
                  >
                    {operations.map((operation) => (
                      <option key={operation.id} value={operation.id}>
                        {operation.preview.token}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={confirmationChecked}
                    onChange={(event) => setConfirmationChecked(event.target.checked)}
                    data-testid="provider-fixer-confirm-checkbox"
                  />
                  {currentPreview?.acknowledgementLabel ?? t.confirmationLabel}
                </label>

                {typedConfirmationRequired ? (
                  <label className="grid gap-1 text-sm text-muted-foreground">
                    <span>{t.typedConfirmLabel}</span>
                    <input
                      className="h-10 rounded-lg border border-input bg-background px-3 font-mono text-foreground"
                      value={typedConfirmation}
                      onChange={(event) => setTypedConfirmation(event.target.value)}
                      onInput={(event) => setTypedConfirmation(event.currentTarget.value)}
                      placeholder={currentPreview?.confirmationText ?? ""}
                      data-testid="provider-fixer-typed-confirmation"
                    />
                  </label>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noOperations}</p>
          )}

          <DataTable
            data-testid="provider-fixer-operations-table"
            data={operations}
            columns={operationColumns}
            rowKey={(operation) => operation.id}
            tableClassName="[&_th]:bg-slate-50/80 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-slate-500"
            emptyState={<div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">{t.noOperations}</div>}
          />

          {selectedOperation ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={executeDisabled}
                onClick={executeSelectedOperation}
                data-testid="provider-fixer-execute-button"
              >
                {t.executeLabel}
              </Button>
              {selectedOperation.canPause ? (
                <Button variant="ghost" disabled={busyAction !== null} onClick={() => mutateOperation(selectedOperation.id, "pause")}>
                  {t.pauseLabel}
                </Button>
              ) : null}
              {selectedOperation.canResume ? (
                <Button variant="ghost" disabled={busyAction !== null} onClick={() => mutateOperation(selectedOperation.id, "resume")}>
                  {t.resumeLabel}
                </Button>
              ) : null}
              {selectedOperation.canCancel ? (
                <Button
                  variant="outline"
                  className="border-rose-200 text-rose-700"
                  disabled={busyAction !== null}
                  onClick={() => mutateOperation(selectedOperation.id, "cancel")}
                >
                  {t.cancelLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          {progressOperation ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{t.runningProgressLabel}</span>
                <span data-testid="provider-fixer-progress-value">
                  {progressOperation.progressPercent === null ? "—" : `${progressOperation.progressPercent}%`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progressOperation.progressPercent ?? 0}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {progressOperation.autoPauseFailureCount !== null &&
                progressOperation.autoPauseFailureThresholdPerMinute !== null ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    Auto-pause: {progressOperation.autoPauseFailureCount}/
                    {progressOperation.autoPauseFailureThresholdPerMinute} minute failures
                  </span>
                ) : null}
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  Snapshot hash: {progressOperation.preview.snapshotHash}
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  Rate cap: {progressOperation.effectiveRateCapPerMinute ?? summary.effectiveRateCapPerMinute}/min
                </span>
              </div>
            </div>
          ) : null}

          <Pagination
            page={operationsPage}
            limit={operationsLimit}
            total={operationsTotal}
            onPageChange={noop}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
          <h2 className="text-xl font-semibold text-foreground">{t.logsTitle}</h2>
          {logs.length > 0 ? (
            <div className="space-y-0">
              {logs.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-2 border-b border-border py-3 text-sm last:border-b-0 md:grid-cols-[170px_1fr]"
                  data-testid={`provider-fixer-log-${entry.id}`}
                >
                  <div className="font-mono text-muted-foreground">{formatTimestamp(entry.occurredAt)}</div>
                  <div className="font-mono text-foreground">
                    <span className="text-muted-foreground">phase={entry.phase}</span> {entry.message}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noLogs}</p>
          )}
          <Pagination page={logsPage} limit={logsLimit} total={logsTotal} onPageChange={noop} />
        </Card>

        <Card className="space-y-4 px-4 py-4 hover:translate-y-0">
          <h2 className="text-xl font-semibold text-foreground">{t.evidenceTitle}</h2>
          {currentPreview && currentPreview.evidenceSample.length > 0 ? (
            <DataTable
              data-testid="provider-fixer-evidence-table"
              data={currentPreview.evidenceSample}
              columns={evidenceColumns}
              rowKey={(row) => `${row.symbol}-${row.providerSymbol}`}
              tableClassName="[&_th]:bg-slate-50/80 [&_th]:px-4 [&_th]:py-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-slate-500"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t.noEvidence}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
