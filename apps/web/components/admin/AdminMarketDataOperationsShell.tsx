"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ProviderOperationOutcomesResponse } from "@vakwen/shared-types";
import type {
  NormalizedOperationItem,
  NormalizedOperationLogEntry,
  NormalizedOperationPage,
} from "../../lib/adminMarketDataOperations";
import {
  localizeOperationOutcomeState,
  localizeOperationPhase,
  localizeOperationPreview,
  localizeOperationType,
  operationSupportsOutcomes,
} from "../../lib/adminMarketDataOperations";
import type { AdminMarketDataOperationLogsResponse } from "../../lib/adminMarketDataService";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { AdminMarketDataResponsiveTable, type AdminMarketDataResponsiveColumn } from "./AdminMarketDataResponsiveTable";
import { formatUtcTimestamp } from "./adminFormat";
import { useAdminI18n } from "./admin-i18n";

interface OperationShellFilters {
  providerId: string;
  operationType: string;
  phase: string;
  search: string;
  startDate: string;
  endDate: string;
}

interface FilterOption {
  value: string;
  label: string;
}

interface OperationFilterOptions {
  providers: FilterOption[];
  operationTypes: FilterOption[];
  phases: FilterOption[];
}

interface OperationShellQueryState {
  page: number;
  limit: number;
  operationId: string;
  outcomesPage: number;
  outcomesLimit: number;
  outcomeState: string;
  outcomeAction: string;
  logsPage: number;
  logsLimit: number;
}

interface OperationShellProps {
  dataTestId: string;
  rowTestIdPrefix?: string;
  pageData: NormalizedOperationPage;
  title: string;
  description: string;
  selectedOperationId: string;
  queryState: OperationShellQueryState;
  filters: OperationShellFilters;
  filterOptions: OperationFilterOptions;
  onApplyFilters: (next: OperationShellFilters) => void;
  onResetFilters: () => void;
  onPageChange: (page: number) => void;
  onSelectOperationId: (operationId: string) => void;
  onClearSelection: () => void;
  onUpdateQueryState: (patch: Partial<OperationShellQueryState>) => void;
  loadLogs: (operation: NormalizedOperationItem, page: number, limit: number) => Promise<AdminMarketDataOperationLogsResponse>;
  loadOutcomes: (operation: NormalizedOperationItem, page: number, limit: number, state: string, action: string) => Promise<ProviderOperationOutcomesResponse>;
  renderOperationActions?: (operation: NormalizedOperationItem) => ReactNode;
  renderExtraInspectorSections?: (operation: NormalizedOperationItem) => ReactNode;
}

function friendlyLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function emptyValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "—";
}

function detailEntries(value: Record<string, unknown> | null, prefix = ""): Array<{ label: string; value: string }> {
  if (!value) return [];
  return Object.entries(value).flatMap(([key, raw]) => {
    const label = prefix ? `${prefix}.${key}` : key;
    if (raw === null || raw === undefined) return [{ label, value: "—" }];
    if (Array.isArray(raw)) {
      return [{ label, value: raw.length === 0 ? "—" : raw.map((item) => (
        typeof item === "object" ? JSON.stringify(item) : String(item)
      )).join(", ") }];
    }
    if (typeof raw === "object") {
      return detailEntries(raw as Record<string, unknown>, label);
    }
    return [{ label, value: String(raw) }];
  });
}

function formatCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((next, [key, value]) => next.replaceAll(`{${key}}`, String(value)), template);
}

const operationInspectorPageSizeOptions = [10, 25, 50, 100];

export function AdminMarketDataOperationsShell({
  dataTestId,
  rowTestIdPrefix,
  pageData,
  title,
  description,
  selectedOperationId,
  queryState,
  filters,
  filterOptions,
  onApplyFilters,
  onResetFilters,
  onPageChange,
  onSelectOperationId,
  onClearSelection,
  onUpdateQueryState,
  loadLogs,
  loadOutcomes,
  renderOperationActions,
  renderExtraInspectorSections,
}: OperationShellProps) {
  const adminDict = useAdminI18n().marketData;
  const [draftFilters, setDraftFilters] = useState(filters);
  const [logs, setLogs] = useState<AdminMarketDataOperationLogsResponse | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [outcomes, setOutcomes] = useState<ProviderOperationOutcomesResponse | null>(null);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [outcomeStateDraft, setOutcomeStateDraft] = useState(queryState.outcomeState);
  const [outcomeActionDraft, setOutcomeActionDraft] = useState(queryState.outcomeAction);
  const totalPages = Math.max(1, Math.ceil(pageData.total / Math.max(pageData.limit, 1)));
  const settingsCopy = {
    columnSettingsButtonLabel: adminDict.columnSettingsButtonLabel,
    columnSettingsTitle: adminDict.columnSettingsTitle,
    dragColumnTitle: adminDict.dragColumnTitle,
    mobileSummaryCountLabel: adminDict.mobileSummaryCountLabel,
    mobileSummaryCountHelp: adminDict.mobileSummaryCountHelp,
    mobileSummaryCountDecreaseAria: adminDict.mobileSummaryCountDecreaseAria,
    mobileSummaryCountIncreaseAria: adminDict.mobileSummaryCountIncreaseAria,
    moveColumnLeftAria: adminDict.moveColumnLeftAria,
    moveColumnRightAria: adminDict.moveColumnRightAria,
    resizeColumnAria: adminDict.resizeColumnAria,
    resetColumnsLabel: adminDict.resetColumnsLabel,
    toggleColumnAria: adminDict.toggleColumnAria,
  };

  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  useEffect(() => {
    setOutcomeStateDraft(queryState.outcomeState);
    setOutcomeActionDraft(queryState.outcomeAction);
  }, [queryState.outcomeAction, queryState.outcomeState]);

  const selectedOperation = useMemo(() => {
    const activeOperationId = typeof selectedOperationId === "string" ? selectedOperationId : "";
    if (activeOperationId.trim().length === 0) return null;
    return pageData.items.find((item) => item.id === activeOperationId)
      ?? (pageData.selectedOperation?.id === activeOperationId ? pageData.selectedOperation : null)
      ?? null;
  }, [pageData.items, pageData.selectedOperation, selectedOperationId]);
  const selectedOutsidePage = selectedOperation !== null && !pageData.items.some((item) => item.id === selectedOperation.id);

  useEffect(() => {
    let cancelled = false;
    if (!selectedOperation) {
      setLogs(null);
      setOutcomes(null);
      setLogsError(null);
      setOutcomesError(null);
      return;
    }

    setLogsLoading(true);
    setLogsError(null);
    void loadLogs(selectedOperation, queryState.logsPage, queryState.logsLimit)
      .then((result) => {
        if (!cancelled) setLogs(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLogsError(error instanceof Error ? error.message : adminDict.operationLogsLoadFailed);
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });

    if (!selectedOperation.providerId) return () => {
      cancelled = true;
    };

    setOutcomesLoading(true);
    setOutcomesError(null);
    void loadOutcomes(
      selectedOperation,
      queryState.outcomesPage,
      queryState.outcomesLimit,
      queryState.outcomeState,
      queryState.outcomeAction,
    )
      .then((result) => {
        if (!cancelled) setOutcomes(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setOutcomesError(error instanceof Error ? error.message : adminDict.operationOutcomesLoadFailed);
      })
      .finally(() => {
        if (!cancelled) setOutcomesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    loadLogs,
    loadOutcomes,
    queryState.logsLimit,
    queryState.logsPage,
    queryState.outcomeAction,
    queryState.outcomeState,
    queryState.outcomesLimit,
    queryState.outcomesPage,
    selectedOperation,
  ]);

  type OperationColumnId = "created" | "operation" | "provider" | "phase" | "preview" | "matches" | "progress";
  const columns = useMemo<Array<AdminMarketDataResponsiveColumn<NormalizedOperationItem, OperationColumnId>>>(() => [
    {
      id: "created",
      label: adminDict.time,
      defaultWidth: 180,
      canHide: false,
      renderCell: (operation) => <span className="font-mono text-xs text-muted-foreground">{emptyValue(operation.createdAt ? formatUtcTimestamp(operation.createdAt) : null)}</span>,
      renderCardValue: (operation) => emptyValue(operation.createdAt ? formatUtcTimestamp(operation.createdAt) : null),
    },
    {
      id: "operation",
      label: adminDict.operationTitle,
      defaultWidth: 220,
      renderCell: (operation) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{localizeOperationType(operation.operationType, adminDict)}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{operation.rawIdLabel}</p>
        </div>
      ),
    },
    {
      id: "provider",
      label: adminDict.provider,
      defaultWidth: 180,
      renderCell: (operation) => <span className="text-muted-foreground">{operation.providerId}</span>,
      renderCardValue: (operation) => operation.providerId,
    },
    {
      id: "phase",
      label: adminDict.phase,
      defaultWidth: 140,
      renderCell: (operation) => <span className="text-muted-foreground">{localizeOperationPhase(operation.phase, adminDict)}</span>,
      renderCardValue: (operation) => localizeOperationPhase(operation.phase, adminDict),
    },
    {
      id: "preview",
      label: adminDict.summary,
      defaultWidth: 320,
      renderCell: (operation) => <span className="text-muted-foreground">{localizeOperationPreview(operation, adminDict)}</span>,
      renderCardValue: (operation) => localizeOperationPreview(operation, adminDict),
    },
    {
      id: "matches",
      label: adminDict.matchesLabel,
      defaultWidth: 120,
      renderCell: (operation) => <span className="text-muted-foreground">{operation.matchCount.toLocaleString()}</span>,
      renderCardValue: (operation) => operation.matchCount.toLocaleString(),
    },
    {
      id: "progress",
      label: adminDict.progress,
      defaultWidth: 120,
      renderCell: (operation) => (
        <span className="text-muted-foreground">
          {operation.progressPercent == null ? adminDict.queued : adminDict.progressPercent.replace("{percent}", String(operation.progressPercent))}
        </span>
      ),
      renderCardValue: (operation) => operation.progressPercent == null ? adminDict.queued : `${operation.progressPercent}%`,
    },
  ], [adminDict]);

  const filterToolbar = (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <form
        className="grid min-w-0 gap-3 lg:grid-cols-[repeat(3,minmax(9rem,1fr))_minmax(14rem,1.4fr)_repeat(2,minmax(9rem,1fr))_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyFilters(draftFilters);
        }}
      >
        <label className="text-sm font-medium text-foreground">
          {adminDict.provider}
          <select
            value={draftFilters.providerId}
            onChange={(event) => setDraftFilters((current) => ({ ...current, providerId: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
            data-testid={`${dataTestId}-provider-filter`}
          >
            {filterOptions.providers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-foreground">
          {adminDict.operationTitle}
          <select
            value={draftFilters.operationType}
            onChange={(event) => setDraftFilters((current) => ({ ...current, operationType: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            {filterOptions.operationTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-foreground">
          {adminDict.phase}
          <select
            value={draftFilters.phase}
            onChange={(event) => setDraftFilters((current) => ({ ...current, phase: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            {filterOptions.phases.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-foreground">
          {adminDict.search}
          <input
            value={draftFilters.search}
            onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder={adminDict.searchPlaceholder}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          {adminDict.operationStartDate}
          <input
            type="date"
            value={draftFilters.startDate}
            onChange={(event) => setDraftFilters((current) => ({ ...current, startDate: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          {adminDict.operationEndDate}
          <input
            type="date"
            value={draftFilters.endDate}
            onChange={(event) => setDraftFilters((current) => ({ ...current, endDate: event.target.value }))}
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 self-end sm:flex sm:flex-wrap sm:justify-end">
          <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{adminDict.operationApply}</button>
          <button type="button" onClick={onResetFilters} className="rounded border border-border px-3 py-2 text-sm text-muted-foreground">{adminDict.operationReset}</button>
        </div>
      </form>
      <p className="text-sm text-muted-foreground">
        {formatCopy(adminDict.operationPageSummary, { page: pageData.page, totalPages, total: pageData.total.toLocaleString() })}
      </p>
      {selectedOutsidePage ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid={`${dataTestId}-off-page-selected`}>
          {formatCopy(adminDict.operationOffPageSelected, { operationId: selectedOperation?.id ?? "" })}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4" data-testid={dataTestId}>
      <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
        <div data-testid={`${dataTestId}-table`}>
          <div data-hydrated="true">
            <AdminMarketDataResponsiveTable
              columns={columns}
              rows={pageData.items}
              contextKey={`admin.marketData.${pageData.marketCode}.operations.shared`}
              emptyMessage={adminDict.operationEmpty}
              rowKey={(operation) => operation.id}
              rowTestId={(operation) => rowTestIdPrefix ? `${rowTestIdPrefix}${operation.id}` : `${dataTestId}-row-${operation.id}`}
              selectedRowKey={selectedOperation?.id ?? null}
              onRowSelect={(operation) => onSelectOperationId(operation.id)}
              settingsCopy={settingsCopy}
              tableTestId={`${dataTestId}-responsive-table`}
              desktopMinWidthClassName="min-w-[78rem]"
              defaultMobileSummaryCount={4}
              toolbar={filterToolbar}
              footer={(
                <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <p>{formatCopy(adminDict.operationPageShort, { page: pageData.page, totalPages })}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onPageChange(Math.max(1, pageData.page - 1))}
                      disabled={pageData.page <= 1}
                      className="rounded border border-border px-3 py-2 disabled:opacity-50"
                    >
                      {adminDict.operationPreviousPage}
                    </button>
                    <button
                      type="button"
                      onClick={() => onPageChange(Math.min(totalPages, pageData.page + 1))}
                      disabled={pageData.page >= totalPages}
                      className="rounded border border-border px-3 py-2 disabled:opacity-50"
                    >
                      {adminDict.operationNextPage}
                    </button>
                  </div>
                </div>
              )}
              getCardIdentity={(operation) => ({
                title: localizeOperationType(operation.operationType, adminDict),
                subtitle: localizeOperationPreview(operation, adminDict),
                badge: <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{operation.providerId}</span>,
              })}
            />
          </div>
        </div>
      </Card>

      <Drawer
        open={selectedOperation !== null}
        onOpenChange={(open) => {
          if (!open) onClearSelection();
        }}
        title={selectedOperation ? localizeOperationType(selectedOperation.operationType, adminDict) : adminDict.operationDetails}
        closeLabel={adminDict.closeDrawerAriaLabel}
        className="md:w-[42rem]"
        bodyClassName="space-y-5"
      >
        {selectedOperation ? (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.summary}</h3>
              <dl className="grid gap-2">
                {[
                  { label: adminDict.provider, value: selectedOperation.providerId },
                  { label: adminDict.market, value: selectedOperation.marketCode },
                  { label: adminDict.phase, value: localizeOperationPhase(selectedOperation.phase, adminDict) },
                  { label: adminDict.matchesLabel, value: selectedOperation.matchCount.toLocaleString() },
                  { label: adminDict.summary, value: localizeOperationPreview(selectedOperation, adminDict) },
                  { label: adminDict.operationId, value: selectedOperation.id },
                  { label: adminDict.progress, value: selectedOperation.progressPercent == null ? adminDict.queued : `${selectedOperation.progressPercent}%` },
                ].map((row) => (
                  <div key={`${selectedOperation.id}:${row.label}`} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="break-words text-sm text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {renderOperationActions ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.operationActions}</h3>
                <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                  {renderOperationActions(selectedOperation)}
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.operationStructuredDetails}</h3>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                {detailEntries(selectedOperation.details).length > 0 ? (
                  <dl className="space-y-2">
                    {detailEntries(selectedOperation.details).map((row) => (
                      <div key={`${selectedOperation.id}:${row.label}`} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3">
                        <dt className="text-xs text-muted-foreground">{friendlyLabel(row.label)}</dt>
                        <dd className="break-words text-sm text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{adminDict.operationNoStructuredDetails}</p>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.logs}</h3>
                <p className="text-xs text-muted-foreground">{formatCopy(adminDict.operationLogPageSummary, { page: logs?.page ?? queryState.logsPage, total: logs?.total ?? 0 })}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                {logsLoading ? <p className="text-sm text-muted-foreground">{adminDict.operationLoadingLogs}</p> : null}
                {logsError ? <p className="text-sm text-destructive">{logsError}</p> : null}
                {!logsLoading && !logsError ? (
                  logs && logs.items.length > 0 ? (
                    <div className="space-y-3">
                      {logs.items.map((entry: NormalizedOperationLogEntry) => (
                        <div key={entry.id} className="rounded border border-border/60 bg-background/70 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatUtcTimestamp(entry.occurredAt)}</span>
                            <span>{friendlyLabel(entry.level)}</span>
                            {entry.phase ? <span>{localizeOperationPhase(entry.phase, adminDict)}</span> : null}
                          </div>
                          <p className="mt-1 text-sm text-foreground">{entry.message}</p>
                          {entry.detail ? <p className="mt-1 text-sm text-muted-foreground">{entry.detail}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{adminDict.operationNoLogs}</p>
                  )
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    {adminDict.operationPageSize}
                    <select
                      data-testid="market-data-operation-logs-limit"
                      value={queryState.logsLimit}
                      onChange={(event) => onUpdateQueryState({ logsPage: 1, logsLimit: Number(event.target.value) })}
                      className="rounded border border-border bg-background px-2 py-1 text-sm"
                    >
                      {operationInspectorPageSizeOptions.map((value) => <option key={`logs-${value}`} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => onUpdateQueryState({ logsPage: Math.max(1, queryState.logsPage - 1) })} disabled={queryState.logsPage <= 1} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{adminDict.operationPreviousLogs}</button>
                  <button type="button" onClick={() => onUpdateQueryState({ logsPage: queryState.logsPage + 1 })} disabled={!!logs && queryState.logsPage >= Math.max(1, Math.ceil(logs.total / Math.max(logs.limit, 1)))} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{adminDict.operationNextLogs}</button>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.outcomes}</h3>
                <p className="text-xs text-muted-foreground">{formatCopy(adminDict.operationLogPageSummary, { page: outcomes?.page ?? queryState.outcomesPage, total: outcomes?.total ?? 0 })}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                {operationSupportsOutcomes(selectedOperation, outcomes) ? (
                  <>
                    <form
                      className="mb-3 flex flex-col gap-2 sm:flex-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onUpdateQueryState({
                          outcomesPage: 1,
                          outcomeState: outcomeStateDraft,
                          outcomeAction: outcomeActionDraft,
                        });
                      }}
                    >
                      <select
                        value={outcomeStateDraft}
                        onChange={(event) => setOutcomeStateDraft(event.target.value)}
                        aria-label={adminDict.operationOutcomeStateFilterLabel}
                        className="rounded border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="all">{adminDict.operationAllStates}</option>
                        <option value="pending">{adminDict.operationStatePending}</option>
                        <option value="running">{adminDict.operationStateRunning}</option>
                        <option value="succeeded">{adminDict.operationStateSucceeded}</option>
                        <option value="failed">{adminDict.operationStateFailed}</option>
                        <option value="skipped">{adminDict.operationStateSkipped}</option>
                        <option value="rate_limited">{adminDict.operationStateRateLimited}</option>
                        <option value="cancelled">{adminDict.operationStateCancelled}</option>
                      </select>
                      <input
                        value={outcomeActionDraft}
                        onChange={(event) => setOutcomeActionDraft(event.target.value)}
                        aria-label={adminDict.operationOutcomeActionFilterLabel}
                        className="min-w-0 rounded border border-border bg-background px-3 py-2 text-sm"
                        placeholder={adminDict.operationFilterAction}
                      />
                      <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{adminDict.operationApply}</button>
                    </form>
                    {outcomesLoading ? <p className="text-sm text-muted-foreground">{adminDict.operationLoadingOutcomes}</p> : null}
                    {outcomesError ? <p className="text-sm text-destructive">{outcomesError}</p> : null}
                    {!outcomesLoading && !outcomesError ? (
                      outcomes && outcomes.items.length > 0 ? (
                        <div className="space-y-3">
                          {outcomes.items.map((item) => (
                            <div key={`${item.operationId}:${item.sourceSymbol}:${item.action}:${item.updatedAt}`} className="rounded border border-border/60 bg-background/70 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="font-mono text-sm text-foreground">{item.sourceSymbol}</p>
                                  <p className="text-xs text-muted-foreground">{item.action} · {localizeOperationOutcomeState(item.state, adminDict)}</p>
                                </div>
                                <span className="text-xs text-muted-foreground">{formatUtcTimestamp(item.updatedAt)}</span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{item.message ?? item.errorCode ?? "—"}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{adminDict.operationNoItemOutcomes}</p>
                      )
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        {adminDict.operationPageSize}
                        <select
                          data-testid="market-data-operation-outcomes-limit"
                          value={queryState.outcomesLimit}
                          onChange={(event) => onUpdateQueryState({ outcomesPage: 1, outcomesLimit: Number(event.target.value) })}
                          className="rounded border border-border bg-background px-2 py-1 text-sm"
                        >
                          {operationInspectorPageSizeOptions.map((value) => <option key={`outcomes-${value}`} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={() => onUpdateQueryState({ outcomesPage: Math.max(1, queryState.outcomesPage - 1) })} disabled={queryState.outcomesPage <= 1} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{adminDict.operationPreviousOutcomes}</button>
                      <button type="button" onClick={() => onUpdateQueryState({ outcomesPage: queryState.outcomesPage + 1 })} disabled={!!outcomes && queryState.outcomesPage >= Math.max(1, Math.ceil(outcomes.total / Math.max(outcomes.limit, 1)))} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">{adminDict.operationNextOutcomes}</button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{adminDict.operationNoOutcomesForType}</p>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.relatedActivity}</h3>
              <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/admin/market-data/${pageData.marketCode}/activity?search=${encodeURIComponent(selectedOperation.relatedActivitySearch)}`}>
                {adminDict.openFilteredActivity}
              </Link>
            </section>

            {renderExtraInspectorSections ? renderExtraInspectorSections(selectedOperation) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.operationSanitizedDebug}</h3>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                {detailEntries(selectedOperation.debugMetadata).length > 0 ? (
                  <dl className="space-y-2">
                    {detailEntries(selectedOperation.debugMetadata).map((row) => (
                      <div key={`${selectedOperation.id}:${row.label}:debug`} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3">
                        <dt className="text-xs text-muted-foreground">{friendlyLabel(row.label)}</dt>
                        <dd className="break-words text-sm text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{adminDict.operationNoDebugMetadata}</p>
                )}
              </div>
            </section>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
