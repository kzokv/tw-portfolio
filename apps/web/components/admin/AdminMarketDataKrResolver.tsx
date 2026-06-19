"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  AdminMarketCode,
  AdminMarketDataActionDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingDto,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemsResponse,
  ProviderUnresolvedListState,
} from "@vakwen/shared-types";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import {
  bulkUpdateProviderUnresolvedState,
  executeProviderRepair,
  mutateProviderOperation,
  previewProviderRepair,
  renewProviderEvidence,
  rerunProviderMapping,
  rerunProviderResolvedUnresolvedItem,
  revertProviderMapping,
  reverifyProviderMapping,
  updateProviderUnresolvedState,
} from "../../lib/adminMarketDataService";
import { formatUtcTimestamp } from "./adminFormat";

export interface KrMappingsData {
  unresolved: ProviderUnresolvedItemsResponse;
  mappings: ProviderResolutionMappingsResponse;
  query: {
    resolverMode: "quote_first" | "chart_probe_v1";
    unresolvedPage: number;
    unresolvedLimit: number;
    unresolvedState: ProviderUnresolvedListState;
    unresolvedSearch: string;
    unresolvedSort: "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
    mappingsPage: number;
    mappingsLimit: number;
    mappingsSearch: string;
  };
}

export interface KrOperationsData {
  operations: ProviderFixerDashboardOperationsResponse;
  selectedOperationId: string;
  outcomes: ProviderOperationOutcomesResponse;
  query: {
    operationsPage: number;
    operationsLimit: number;
    operationOutcomesPage: number;
    operationOutcomesLimit: number;
    operationOutcomeState: "pending" | "running" | "succeeded" | "failed" | "skipped" | "rate_limited" | "cancelled" | "all";
    operationOutcomeAction: string;
  };
}

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

const yahooKrProviderId = "yahoo-finance-kr";
const yahooKrErrorCode = "yahoo_finance_kr_symbol_unresolved";

function formatTimestamp(value: string | null): string {
  return formatUtcTimestamp(value);
}

function unresolvedItemKey(item: Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">): string {
  return `${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`;
}

function mappingLinkedOperation(evidence: Record<string, unknown> | null): string | null {
  const raw = evidence?.operationId ?? evidence?.providerOperationId ?? evidence?.retryOfOperationId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function mappingEvidenceSummary(mapping: ProviderResolutionMappingDto): string {
  const evidence = mapping.evidence;
  for (const key of ["candidate", "candidateSymbol", "exchangeHint", "note"]) {
    const value = evidence?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Stored durable mapping";
}

function krResolverModeHelp(mode: KrMappingsData["query"]["resolverMode"]): string {
  if (mode === "chart_probe_v1") {
    return "Chart-probe verifies chart/backfill readiness with chart requests. It costs more provider budget and is useful when quote evidence is ambiguous.";
  }
  return "Quote-first checks quote metadata before chart calls. It is the cheaper default and only writes after guarded preview execution.";
}

function previewExpired(operation: ProviderFixerDashboardOperationDto | null): boolean {
  if (!operation?.preview.tokenExpiresAt) return true;
  return new Date(operation.preview.tokenExpiresAt).getTime() <= Date.now();
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function exportUnresolvedCsv(items: ProviderUnresolvedItemDto[], filename: string) {
  const headers = [
    "providerId",
    "marketCode",
    "errorCode",
    "sourceSymbol",
    "providerSymbol",
    "state",
    "occurrenceCount",
    "firstSeenAt",
    "lastSeenAt",
    "updatedAt",
    "resolvedAt",
    "resolvedByOperationId",
  ];
  const rows = items.map((item) => [
    item.providerId,
    item.marketCode,
    item.errorCode,
    item.sourceSymbol,
    item.providerSymbol ?? "",
    item.state,
    item.occurrenceCount,
    item.firstSeenAt,
    item.lastSeenAt,
    item.updatedAt,
    item.resolvedAt ?? "",
    item.resolvedByOperationId ?? "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function krMappingsPath(query: Partial<KrMappingsData["query"]>): string {
  const params = new URLSearchParams();
  const merged: KrMappingsData["query"] = {
    resolverMode: query.resolverMode ?? "quote_first",
    unresolvedPage: query.unresolvedPage ?? 1,
    unresolvedLimit: query.unresolvedLimit ?? 25,
    unresolvedState: query.unresolvedState ?? "active",
    unresolvedSearch: query.unresolvedSearch ?? "",
    unresolvedSort: query.unresolvedSort ?? "last_seen_desc",
    mappingsPage: query.mappingsPage ?? 1,
    mappingsLimit: query.mappingsLimit ?? 25,
    mappingsSearch: query.mappingsSearch ?? "",
  };
  if (merged.resolverMode !== "quote_first") params.set("resolverMode", merged.resolverMode);
  if (merged.unresolvedPage !== 1) params.set("unresolvedPage", String(merged.unresolvedPage));
  if (merged.unresolvedLimit !== 25) params.set("unresolvedLimit", String(merged.unresolvedLimit));
  if (merged.unresolvedState !== "active") params.set("unresolvedState", merged.unresolvedState);
  if (merged.unresolvedSearch.trim()) params.set("unresolvedSearch", merged.unresolvedSearch.trim());
  if (merged.unresolvedSort !== "last_seen_desc") params.set("unresolvedSort", merged.unresolvedSort);
  if (merged.mappingsPage !== 1) params.set("mappingsPage", String(merged.mappingsPage));
  if (merged.mappingsLimit !== 25) params.set("mappingsLimit", String(merged.mappingsLimit));
  if (merged.mappingsSearch.trim()) params.set("mappingsSearch", merged.mappingsSearch.trim());
  const queryString = params.toString();
  return `/admin/market-data/KR/mappings${queryString ? `?${queryString}` : ""}`;
}

function krOperationsPath(query: Partial<KrOperationsData["query"]> & { operationId?: string; providerId?: string }): string {
  const params = new URLSearchParams();
  const providerId = query.providerId ?? yahooKrProviderId;
  if (providerId !== yahooKrProviderId) params.set("providerId", providerId);
  if (query.operationId) params.set("operationId", query.operationId);
  const operationsPage = query.operationsPage ?? 1;
  const operationsLimit = query.operationsLimit ?? 25;
  const operationOutcomesPage = query.operationOutcomesPage ?? 1;
  const operationOutcomesLimit = query.operationOutcomesLimit ?? 25;
  const operationOutcomeState = query.operationOutcomeState ?? "all";
  const operationOutcomeAction = query.operationOutcomeAction ?? "";
  if (operationsPage !== 1) params.set("operationsPage", String(operationsPage));
  if (operationsLimit !== 25) params.set("operationsLimit", String(operationsLimit));
  if (operationOutcomesPage !== 1) params.set("operationOutcomesPage", String(operationOutcomesPage));
  if (operationOutcomesLimit !== 25) params.set("operationOutcomesLimit", String(operationOutcomesLimit));
  if (operationOutcomeState !== "all") params.set("operationOutcomeState", operationOutcomeState);
  if (operationOutcomeAction.trim()) params.set("operationOutcomeAction", operationOutcomeAction.trim());
  const queryString = params.toString();
  return `/admin/market-data/KR/operations${queryString ? `?${queryString}` : ""}`;
}

export function MappingsPanel({
  marketCode,
  actions,
  krMappings,
}: {
  marketCode: AdminMarketCode;
  actions: AdminMarketDataActionDto[];
  krMappings: KrMappingsData | null;
}) {
  if (marketCode !== "KR" || !krMappings) {
    return (
      <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-mappings">
        <h2 className="text-base font-semibold text-foreground">Provider mappings</h2>
        <p className="mt-2 text-sm text-muted-foreground">Mappings are not available for this market.</p>
      </Card>
    );
  }
  return <KrMappingsPanel actions={actions} data={krMappings} />;
}

type KrRepairScope =
  | {
      type: "selected_items";
      items: Array<Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">>;
    }
  | {
      type: "filter";
      marketCode: ProviderUnresolvedItemDto["marketCode"];
      errorCode: string;
      state: "active";
      search?: string;
    };

interface KrSelectedScope {
  type: "selected_items" | "filter";
  count: number;
  label: string;
  fingerprint: string;
  scope: KrRepairScope;
}

function krSelectedScopeFingerprint(scope: KrRepairScope): string {
  if (scope.type === "filter") {
    return JSON.stringify({
      type: scope.type,
      marketCode: scope.marketCode,
      errorCode: scope.errorCode,
      state: scope.state,
      search: scope.search ?? null,
    });
  }
  return JSON.stringify({
    type: scope.type,
    items: scope.items.map(unresolvedItemKey).sort(),
  });
}

function krPreviewMatchesScope(operation: ProviderFixerDashboardOperationDto | null, selectedScope: KrSelectedScope | null): boolean {
  if (!operation || !selectedScope) return false;
  const frozenScope = operation.preview.frozenScope;
  if (!frozenScope) return false;
  if (frozenScope.type !== selectedScope.type) return false;
  if (selectedScope.scope.type === "filter") {
    const filter = frozenScope.filter;
    return !!filter
      && filter.providerId === yahooKrProviderId
      && filter.marketCode === selectedScope.scope.marketCode
      && filter.errorCode === selectedScope.scope.errorCode
      && filter.state === selectedScope.scope.state
      && (filter.search?.trim() || null) === (selectedScope.scope.search?.trim() || null)
      && frozenScope.matchCount === selectedScope.count;
  }
  const frozenKeys = frozenScope.selectedItems.map(unresolvedItemKey).sort();
  const selectedKeys = selectedScope.scope.items.map(unresolvedItemKey).sort();
  return frozenKeys.length === selectedKeys.length && frozenKeys.every((key, index) => key === selectedKeys[index]);
}

function KrMappingsPanel({
  actions,
  data,
}: {
  actions: AdminMarketDataActionDto[];
  data: KrMappingsData;
}) {
  const router = useRouter();
  const mappingAction = actions.find((action) => action.action === "repair_mapping");
  const resolverMode = data.query.resolverMode;
  const [unresolvedSearch, setUnresolvedSearch] = useState(data.query.unresolvedSearch);
  const [unresolvedState, setUnresolvedState] = useState<ProviderUnresolvedListState>(data.query.unresolvedState);
  const [unresolvedSort, setUnresolvedSort] = useState<KrMappingsData["query"]["unresolvedSort"]>(data.query.unresolvedSort);
  const [mappingsSearch, setMappingsSearch] = useState(data.query.mappingsSearch);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProviderFixerDashboardOperationDto | null>(null);
  const [previewScopeDetails, setPreviewScopeDetails] = useState<KrSelectedScope | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [revertTarget, setRevertTarget] = useState<string | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState("");

  useEffect(() => {
    setUnresolvedSearch(data.query.unresolvedSearch);
    setUnresolvedState(data.query.unresolvedState);
    setUnresolvedSort(data.query.unresolvedSort);
    setMappingsSearch(data.query.mappingsSearch);
    setSelectedKeys(new Set());
    setAllMatchingSelected(false);
    setPreview(null);
    setPreviewScopeDetails(null);
    setTypedConfirmation("");
    setAcknowledged(false);
  }, [
    data.query.resolverMode,
    data.query.unresolvedPage,
    data.query.unresolvedLimit,
    data.query.unresolvedState,
    data.query.unresolvedSearch,
    data.query.unresolvedSort,
    data.query.mappingsPage,
    data.query.mappingsLimit,
    data.query.mappingsSearch,
  ]);

  const visibleItems = data.unresolved.items;
  const visibleKeys = visibleItems.map(unresolvedItemKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  const selectedItems = visibleItems.filter((item) => selectedKeys.has(unresolvedItemKey(item)));
  const activeFilterSelected = data.query.unresolvedState === "active";
  const selectedScopeDetails = useMemo<KrSelectedScope | null>(() => {
    if (allMatchingSelected) {
      const scope: KrRepairScope = {
        type: "filter",
        marketCode: "KR",
        errorCode: yahooKrErrorCode,
        state: "active",
        ...(data.query.unresolvedSearch.trim() ? { search: data.query.unresolvedSearch.trim() } : {}),
      };
      return {
        type: "filter",
        count: data.unresolved.total,
        label: "All active rows matching the current KR unresolved filter",
        fingerprint: krSelectedScopeFingerprint(scope),
        scope,
      };
    }
    if (selectedItems.length === 0) return null;
    const scope: KrRepairScope = {
      type: "selected_items",
      items: selectedItems.map((item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
      })),
    };
    return {
      type: "selected_items",
      count: selectedItems.length,
      label: selectedItems.length === 1 ? "1 selected unresolved row" : `${selectedItems.length.toLocaleString()} selected unresolved rows`,
      fingerprint: krSelectedScopeFingerprint(scope),
      scope,
    };
  }, [allMatchingSelected, data.query.unresolvedSearch, data.unresolved.total, selectedItems]);
  const selectedCount = selectedScopeDetails?.count ?? 0;
  const previewIsExpired = previewExpired(preview);
  const previewMatchesCurrentScope = krPreviewMatchesScope(preview, previewScopeDetails ?? selectedScopeDetails);

  function pushQuery(next: Partial<KrMappingsData["query"]>) {
    router.push(krMappingsPath({ ...data.query, ...next }));
  }

  function selectedScope(): KrRepairScope | null {
    return selectedScopeDetails?.scope ?? null;
  }

  function toggleVisible(checked: boolean) {
    setAllMatchingSelected(false);
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        const key = unresolvedItemKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function runWithMessage<T>(label: string, task: () => Promise<T>, success: (result: T) => string) {
    setBusyAction(label);
    setMessage(null);
    try {
      const result = await task();
      setMessage(success(result));
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function setUnresolvedStateForItem(item: ProviderUnresolvedItemDto, state: Exclude<ProviderUnresolvedItemDto["state"], "resolved">) {
    await runWithMessage(
      `state-${item.sourceSymbol}`,
      () => updateProviderUnresolvedState({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        state,
      }),
      (result) => `Set unresolved item ${result.item.sourceSymbol} to ${result.item.state}.`,
    );
  }

  async function bulkSetState(state: "unsupported" | "ignored") {
    if (selectedCount === 0) return;
    const scope = selectedScope();
    if (!scope || !selectedScopeDetails) return;
    const typedConfirmationForFilter = scope.type === "filter"
      ? state === "ignored"
        ? `IGNORE ${selectedCount} MATCHING ACTIVE`
        : `MARK ${selectedCount} MATCHING UNSUPPORTED`
      : undefined;
    const acknowledged = scope.type === "selected_items";
    let typedConfirmation: string | undefined;
    if (typedConfirmationForFilter) {
      typedConfirmation = window.prompt(`Type ${typedConfirmationForFilter} to ${state === "ignored" ? "ignore" : "mark unsupported"} this all-matching KR scope.`)?.trim();
      if (typedConfirmation !== typedConfirmationForFilter) {
        setMessage(`Bulk ${state} requires the exact phrase ${typedConfirmationForFilter}.`);
        return;
      }
    } else if (!window.confirm(`Apply ${state} to ${selectedScopeDetails.label}?`)) {
      return;
    }
    await runWithMessage(
      `bulk-${state}`,
      () => bulkUpdateProviderUnresolvedState({
        providerId: yahooKrProviderId,
        state,
        scope,
        acknowledged,
        typedConfirmation,
      }),
      (result) => `Updated ${result.updatedCount} unresolved rows.`,
    );
  }

  async function previewRepairScope(scopeDetails: KrSelectedScope) {
    await runWithMessage(
      "preview-repair",
      () => previewProviderRepair({
        providerId: yahooKrProviderId,
        marketCode: "KR",
        errorCode: yahooKrErrorCode,
        resolverMode,
        scope: scopeDetails.scope,
      }),
      (result) => {
        setPreview(result.operation);
        setPreviewScopeDetails(scopeDetails);
        setTypedConfirmation("");
        setAcknowledged(false);
        return `Repair preview created for ${result.operation.matchCount} rows.`;
      },
    );
  }

  async function previewSelectedRepair() {
    if (selectedCount === 0 || !selectedScopeDetails) return;
    await previewRepairScope(selectedScopeDetails);
  }

  async function previewUnresolvedItemRepair(item: ProviderUnresolvedItemDto) {
    const scope: KrRepairScope = {
      type: "selected_items",
      items: [{
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
      }],
    };
    setAllMatchingSelected(false);
    setSelectedKeys(new Set([unresolvedItemKey(item)]));
    await previewRepairScope({
      type: "selected_items",
      count: 1,
      label: `Repair ${item.sourceSymbol}`,
      fingerprint: krSelectedScopeFingerprint(scope),
      scope,
    });
  }

  async function renewSelectedEvidence() {
    if (selectedCount === 0) return;
    const scope = selectedScope();
    if (!scope) return;
    await runWithMessage(
      "renew-evidence",
      () => renewProviderEvidence({
        providerId: yahooKrProviderId,
        marketCode: "KR",
        errorCode: yahooKrErrorCode,
        resolverMode,
        scope,
      }),
      (result) => `Renew evidence started: ${result.operation.id}`,
    );
  }

  async function rerunUnresolvedItem(item: ProviderUnresolvedItemDto) {
    if (item.state !== "resolved") return;
    await runWithMessage(
      `rerun-${item.sourceSymbol}`,
      () => rerunProviderResolvedUnresolvedItem({
        providerId: item.providerId,
        marketCode: item.marketCode,
        sourceSymbol: item.sourceSymbol,
        resolverMode,
      }),
      (result) => `Rerun queued: ${result.operation.id}`,
    );
  }

  async function executePreview() {
    if (!preview?.preview.token || !previewMatchesCurrentScope || previewIsExpired || !preview.canExecute) return;
    await runWithMessage(
      "execute-repair",
      () => executeProviderRepair({
        providerId: yahooKrProviderId,
        operationId: preview.id,
        previewToken: preview.preview.token,
        acknowledged,
        typedConfirmation: typedConfirmation.trim(),
      }),
      (result) => {
        setPreview(result.operation);
        return `Repair operation ${result.operation.id} started.`;
      },
    );
  }

  const executeDisabled = !preview
    || busyAction !== null
    || previewIsExpired
    || !preview.canExecute
    || !previewMatchesCurrentScope
    || !acknowledged
    || (preview.preview.confirmationText ? typedConfirmation.trim() !== preview.preview.confirmationText : false);

  return (
    <div className="space-y-5" data-testid="market-data-mappings">
      <Card className="px-5 py-4 hover:translate-y-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">KR mapping repair</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Repair persists verified Yahoo Finance KR mappings only. Backfill after mapping is a separate explicit action.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Twelve Data KR remains the catalog/evidence source; Yahoo Finance KR owns durable mappings, bars, and dividends.
            </p>
          </div>
          <div className="min-w-0 rounded border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">Resolver mode</p>
            <div className="mt-2 inline-flex max-w-full overflow-hidden rounded border border-border">
              {(["quote_first", "chart_probe_v1"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => pushQuery({ resolverMode: mode })}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium",
                    resolverMode === mode ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                  title={krResolverModeHelp(mode)}
                  data-testid={`provider-console-resolver-mode-${mode}`}
                >
                  {mode === "quote_first" ? "Quote-first" : "Chart-probe"}
                </button>
              ))}
            </div>
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{krResolverModeHelp(resolverMode)}</p>
            {mappingAction?.disabledReason ? (
              <p className="mt-2 text-xs text-amber-700">{mappingAction.disabledReason}</p>
            ) : null}
          </div>
        </div>
        {message ? <p className="mt-4 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </Card>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Unique unresolved instruments</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Durable unresolved rows from Yahoo Finance KR. Resolver behavior is unchanged; this panel only scopes admin repair work.
              </p>
            </div>
            <button
              type="button"
              disabled={selectedCount === 0 || busyAction !== null}
              onClick={() => void previewSelectedRepair()}
              className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Repair selected
            </button>
          </div>
          <form
            className="mt-4 grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_12rem_14rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              pushQuery({
                unresolvedPage: 1,
                unresolvedSearch,
                unresolvedState,
                unresolvedSort,
              });
            }}
          >
            <label className="text-sm font-medium text-foreground">
              Search
              <input
                value={unresolvedSearch}
                onChange={(event) => setUnresolvedSearch(event.target.value)}
                placeholder="Search symbol, provider symbol, error"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-search"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              State
              <select
                value={unresolvedState}
                onChange={(event) => setUnresolvedState(event.target.value as ProviderUnresolvedListState)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-state"
              >
                <option value="active">active</option>
                <option value="all">all</option>
                <option value="resolved">resolved</option>
                <option value="unsupported">unsupported</option>
                <option value="ignored">ignored</option>
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              Sort
              <select
                value={unresolvedSort}
                onChange={(event) => setUnresolvedSort(event.target.value as KrMappingsData["query"]["unresolvedSort"])}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-sort"
              >
                <option value="last_seen_desc">last seen</option>
                <option value="updated_desc">recently updated</option>
                <option value="occurrence_count_desc">most occurrences</option>
                <option value="source_symbol_asc">source symbol</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                data-testid="provider-console-unresolved-apply"
              >
                Apply filters
              </button>
            </div>
          </form>
          <div className="mt-4 flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between" data-testid="provider-console-selection-banner">
            <span><strong>{selectedCount.toLocaleString()} rows selected.</strong> {data.unresolved.total.toLocaleString()} rows match this filter.</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeFilterSelected || data.unresolved.total === 0}
                onClick={() => {
                  setSelectedKeys(new Set());
                  setAllMatchingSelected((current) => !current);
                }}
                className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                data-testid="provider-console-select-all-matching"
              >
                {allMatchingSelected ? "Clear all matching" : "Select all matching"}
              </button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void previewSelectedRepair()} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50">Repair</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void renewSelectedEvidence()} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-renew">Renew</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void bulkSetState("ignored")} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-ignore">Ignore</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void bulkSetState("unsupported")} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-unsupported">Unsupported</button>
              <button
                type="button"
                disabled={visibleItems.length === 0}
                onClick={() => exportUnresolvedCsv(visibleItems, "yahoo-finance-kr-unresolved.csv")}
                className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                data-testid="provider-console-unresolved-export"
              >
                Export CSV
              </button>
              <button type="button" disabled={selectedCount === 0} onClick={() => { setSelectedKeys(new Set()); setAllMatchingSelected(false); }} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50">Clear selection</button>
              <button type="button" onClick={() => pushQuery({ unresolvedState: "resolved", unresolvedSort: "updated_desc", unresolvedPage: 1 })} className="rounded border border-border bg-background px-2 py-1 text-xs" data-testid="provider-console-recently-resolved">Recently resolved</button>
            </div>
          </div>
          <div className="mt-4 rounded border border-border bg-muted/20 p-4 text-sm" data-testid="provider-console-repair-scope">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="font-semibold text-foreground">Selected repair scope</h4>
                <p className="mt-1 text-muted-foreground">
                  Execution uses the backend frozen scope from the preview token, not whatever rows happen to be visible later.
                </p>
              </div>
              <span className={cn(
                "w-fit rounded-full px-2 py-1 text-xs font-semibold",
                !preview && "bg-slate-100 text-slate-700",
                preview && previewIsExpired && "bg-rose-100 text-rose-700",
                preview && !previewIsExpired && previewMatchesCurrentScope && "bg-emerald-100 text-emerald-700",
                preview && !previewIsExpired && !previewMatchesCurrentScope && "bg-amber-100 text-amber-800",
              )}>
                {!preview
                  ? "No preview"
                  : previewIsExpired
                    ? "Preview expired"
                    : previewMatchesCurrentScope
                      ? "Preview matches scope"
                      : "Preview scope changed"}
              </span>
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Provider</dt><dd className="mt-1 font-medium text-foreground">{yahooKrProviderId}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Resolver mode</dt><dd className="mt-1 font-medium text-foreground">{resolverMode.replace(/_/g, " ")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Scope</dt><dd className="mt-1 font-medium text-foreground">{previewScopeDetails?.type === "filter" || selectedScopeDetails?.type === "filter" ? "All matching filter" : previewScopeDetails || selectedScopeDetails ? "Selected rows" : "None selected"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Count</dt><dd className="mt-1 font-medium text-foreground">{(previewScopeDetails?.count ?? selectedCount).toLocaleString()}</dd></div>
            </dl>
          </div>
          {preview ? (
            <div className="mt-4 rounded border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-semibold text-foreground">Repair preview</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Operation {preview.id} matches {preview.matchCount.toLocaleString()} rows. Execute uses the frozen preview token.
              </p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className={cn("rounded border px-3 py-2", preview.canExecute ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                  Operation executable: {preview.canExecute ? "yes" : "no"}
                </div>
                <div className={cn("rounded border px-3 py-2", !previewIsExpired ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
                  Token valid: {!previewIsExpired ? "yes" : "expired"}
                </div>
                <div className={cn("rounded border px-3 py-2", preview.preview.frozenScope ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
                  Frozen scope: {preview.preview.frozenScope ? "available" : "missing"}
                </div>
                <div className={cn("rounded border px-3 py-2", previewMatchesCurrentScope ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                  Scope match: {previewMatchesCurrentScope ? "yes" : "refresh preview"}
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  data-testid="provider-console-confirm-checkbox"
                />
                I reviewed the frozen scope and understand this writes verified KR mappings only.
              </label>
              {preview.preview.confirmationText ? (
                <label className="mt-3 block text-sm font-medium text-foreground">
                  Type confirmation
                  <input
                    value={typedConfirmation}
                    onChange={(event) => setTypedConfirmation(event.target.value)}
                    placeholder={preview.preview.confirmationText}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                    data-testid="provider-console-typed-confirmation"
                  />
                </label>
              ) : null}
              {preview.preview.evidenceSample.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded border border-border" data-testid="provider-console-preview-evidence">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Provider symbol</th>
                        <th className="px-3 py-2">Candidate</th>
                        <th className="px-3 py-2">Evidence</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.evidenceSample.map((item) => (
                        <tr key={`${item.symbol}:${item.providerSymbol}:${item.candidateSymbol ?? "none"}`} className="border-t border-border">
                          <td className="px-3 py-2 font-mono">{item.symbol}</td>
                          <td className="px-3 py-2 font-mono">{item.providerSymbol}</td>
                          <td className="px-3 py-2 font-mono">{item.candidateSymbol ?? "-"}</td>
                          <td className="px-3 py-2">{item.exchangeHint ?? item.note}</td>
                          <td className="px-3 py-2">{item.verificationStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <button
                type="button"
                disabled={executeDisabled}
                onClick={() => void executePreview()}
                className="mt-3 rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
                title={executeDisabled ? "Execution requires a valid matching preview, acknowledgement, and typed confirmation when required." : "Execute the frozen KR mapping repair preview."}
                data-testid="provider-console-execute-button"
              >
                Execute operation
              </button>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={visibleItems.length === 0 || allMatchingSelected}
                    onChange={(event) => toggleVisible(event.target.checked)}
                    aria-label="Select visible rows"
                    data-testid="provider-console-select-visible"
                  />
                </th>
                <th className="px-5 py-3">Source symbol</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleItems.map((item) => {
                const key = unresolvedItemKey(item);
                const selected = selectedKeys.has(key);
                return (
                  <tr key={key}>
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={allMatchingSelected}
                        onChange={(event) => {
                          setSelectedKeys((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                        aria-label={`Select ${item.sourceSymbol}`}
                        data-testid={`provider-console-select-row-${item.sourceSymbol}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-mono font-semibold text-foreground">{item.sourceSymbol}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.providerSymbol ?? item.sourceSymbol}</p>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{item.state}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {item.occurrenceCount.toLocaleString()} occurrences; last seen {formatTimestamp(item.lastSeenAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.state !== "active" ? (
                          <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "active")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-reopen-${item.sourceSymbol}`}>Reopen</button>
                        ) : (
                          <>
                            <button type="button" disabled={busyAction !== null} onClick={() => void previewUnresolvedItemRepair(item)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-repair-${item.sourceSymbol}`}>Repair</button>
                            <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "unsupported")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-unsupported-${item.sourceSymbol}`}>Unsupported</button>
                            <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "ignored")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-ignore-${item.sourceSymbol}`}>Ignore</button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={item.state !== "resolved" || busyAction !== null}
                          onClick={() => void rerunUnresolvedItem(item)}
                          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                          title={item.state === "resolved" ? "Create a provider operation that fetches fresh Yahoo KR data for this resolved row." : "Rerun requires a resolved durable mapping."}
                          data-testid={`provider-console-unresolved-rerun-${item.sourceSymbol}`}
                        >
                          Rerun
                        </button>
                      </div>
                      <p className="mt-1 text-right text-xs text-muted-foreground">Rerun requires resolved mapping.</p>
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-sm text-muted-foreground">No unresolved rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4 text-sm">
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, unresolvedPage: Math.max(1, data.query.unresolvedPage - 1) })}>Previous</Link>
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, unresolvedPage: data.query.unresolvedPage + 1 })}>Next</Link>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Durable KR mappings</h3>
          <p className="mt-1 text-sm text-muted-foreground">Stored Yahoo Finance KR bindings with evidence and operation links.</p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              pushQuery({ mappingsSearch, mappingsPage: 1 });
            }}
          >
            <input
              value={mappingsSearch}
              onChange={(event) => setMappingsSearch(event.target.value)}
              placeholder="Source symbol, provider symbol, or operation ID"
              className="rounded border border-border bg-background px-3 py-2 text-sm"
              data-testid="provider-console-mappings-search"
            />
            <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Search mappings</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Resolved</th>
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3">Links</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.mappings.items.map((mapping) => {
                const key = `${mapping.providerId}:${mapping.marketCode}:${mapping.sourceSymbol}`;
                const linkedOperationId = mappingLinkedOperation(mapping.evidence);
                const phrase = `REVERT ${mapping.sourceSymbol}`;
                const revertOpen = revertTarget === key;
                const revertReady = revertConfirmation.trim() === phrase;
                return (
                  <tr key={key}>
                    <td className="px-5 py-4 font-mono font-semibold text-foreground">{mapping.sourceSymbol}</td>
                    <td className="px-5 py-4 font-mono text-muted-foreground">{mapping.resolvedSymbol}</td>
                    <td className="px-5 py-4 text-muted-foreground">{mappingEvidenceSummary(mapping)}; verified {formatTimestamp(mapping.verifiedAt)}</td>
                    <td className="px-5 py-4 text-xs">
                      <button
                        type="button"
                        className="block font-mono text-primary underline-offset-4 hover:underline"
                        onClick={() => pushQuery({ unresolvedState: "all", unresolvedSearch: mapping.sourceSymbol, unresolvedPage: 1 })}
                        data-testid={`provider-console-mapping-unresolved-link-${mapping.sourceSymbol}`}
                      >
                        Unresolved: {mapping.sourceSymbol}
                      </button>
                      {linkedOperationId ? (
                        <Link
                          className="mt-1 block font-mono text-primary underline-offset-4 hover:underline"
                          href={`/admin/market-data/KR/operations?providerId=${encodeURIComponent(mapping.providerId)}&operationId=${encodeURIComponent(linkedOperationId)}`}
                          data-testid={`provider-console-mapping-operation-link-${mapping.sourceSymbol}`}
                        >
                          Operation: {linkedOperationId}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" disabled={busyAction !== null} onClick={() => void runWithMessage("reverify", () => reverifyProviderMapping({ providerId: mapping.providerId, mapping, resolverMode: mapping.resolverMode ?? resolverMode }), (result) => `Reverify started: ${result.operation.id}`)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-reverify-${mapping.sourceSymbol}`}>Reverify</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => void runWithMessage("rerun-mapping", () => rerunProviderMapping({ providerId: mapping.providerId, mapping, resolverMode: mapping.resolverMode ?? resolverMode }), (result) => `Rerun queued: ${result.operation.id}`)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-rerun-${mapping.sourceSymbol}`}>Rerun</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => { setRevertTarget(revertOpen ? null : key); setRevertConfirmation(""); }} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-revert-open-${mapping.sourceSymbol}`}>Revert</button>
                      </div>
                      {revertOpen ? (
                        <div className="mt-3 grid gap-2">
                          <p className="text-xs text-red-700">Type {phrase} to remove this mapping.</p>
                          <input
                            value={revertConfirmation}
                            onChange={(event) => setRevertConfirmation(event.target.value)}
                            placeholder={phrase}
                            className="rounded border border-red-300 bg-background px-3 py-2 text-sm"
                            data-testid={`provider-console-mapping-revert-confirmation-${mapping.sourceSymbol}`}
                          />
                          <button
                            type="button"
                            disabled={!revertReady || busyAction !== null}
                            onClick={() => void runWithMessage("revert-mapping", () => revertProviderMapping({ providerId: mapping.providerId, mapping, typedConfirmation: revertConfirmation.trim() }), (result) => `Revert started: ${result.operation.id}`)}
                            className="rounded bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                            data-testid={`provider-console-mapping-revert-execute-${mapping.sourceSymbol}`}
                          >
                            Execute revert
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {data.mappings.items.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-sm text-muted-foreground">No durable mappings match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4 text-sm">
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, mappingsPage: Math.max(1, data.query.mappingsPage - 1) })}>Previous</Link>
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, mappingsPage: data.query.mappingsPage + 1 })}>Next</Link>
        </div>
      </Card>
    </div>
  );
}

export function KrOperationsPanel({ data }: { data: KrOperationsData }) {
  const router = useRouter();
  const operationRows = useMemo(() => {
    const rows = [...data.operations.operations];
    if (data.operations.stagedOperation && !rows.some((operation) => operation.id === data.operations.stagedOperation?.id)) {
      rows.unshift(data.operations.stagedOperation);
    }
    if (data.operations.selectedOperation && !rows.some((operation) => operation.id === data.operations.selectedOperation?.id)) {
      rows.unshift(data.operations.selectedOperation);
    }
    return rows;
  }, [data.operations.operations, data.operations.selectedOperation, data.operations.stagedOperation]);
  const selectedOperation =
    data.operations.selectedOperation
    ?? operationRows.find((operation) => operation.id === data.selectedOperationId)
    ?? operationRows[0]
    ?? null;
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [outcomeActionInput, setOutcomeActionInput] = useState(data.query.operationOutcomeAction);
  const [outcomeStateInput, setOutcomeStateInput] = useState<KrOperationsData["query"]["operationOutcomeState"]>(data.query.operationOutcomeState);

  useEffect(() => {
    setAcknowledged(false);
    setTypedConfirmation("");
  }, [selectedOperation?.id]);

  useEffect(() => {
    setOutcomeActionInput(data.query.operationOutcomeAction);
    setOutcomeStateInput(data.query.operationOutcomeState);
  }, [data.query.operationOutcomeAction, data.query.operationOutcomeState]);

  function pushOperations(next: Partial<KrOperationsData["query"]> & { operationId?: string; providerId?: string }) {
    router.push(krOperationsPath({
      ...data.query,
      operationId: selectedOperation?.id,
      ...next,
    }));
  }

  async function runOperationAction<T>(label: string, task: () => Promise<T>, success: (result: T) => string) {
    setBusyAction(label);
    setMessage(null);
    try {
      const result = await task();
      setMessage(success(result));
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function controlOperation(operation: ProviderFixerDashboardOperationDto, action: "pause" | "resume" | "cancel" | "retry") {
    await runOperationAction(
      `${action}-${operation.id}`,
      () => mutateProviderOperation({ providerId: operation.providerId, operationId: operation.id, action }),
      (result) => {
        if (action === "retry") {
          router.push(krOperationsPath({ ...data.query, operationId: result.operation.id, operationOutcomesPage: 1 }));
        }
        return `${action} updated operation ${result.operation.id}.`;
      },
    );
  }

  async function executeOperation() {
    if (!selectedOperation?.preview.token) return;
    await runOperationAction(
      `execute-${selectedOperation.id}`,
      () => executeProviderRepair({
        providerId: selectedOperation.providerId,
        operationId: selectedOperation.id,
        previewToken: selectedOperation.preview.token,
        acknowledged,
        typedConfirmation: typedConfirmation.trim(),
      }),
      (result) => `Repair operation ${result.operation.id} started.`,
    );
  }

  const selectedPreviewExpired = previewExpired(selectedOperation);
  const typedConfirmationRequired = !!selectedOperation?.dangerous && !!selectedOperation.preview.confirmationText;
  const executeDisabled =
    !selectedOperation
    || busyAction !== null
    || !selectedOperation.canExecute
    || selectedPreviewExpired
    || !selectedOperation.preview.frozenScope
    || !acknowledged
    || (typedConfirmationRequired && typedConfirmation.trim() !== selectedOperation.preview.confirmationText);
  const summary = data.outcomes.summary;

  return (
    <div className="space-y-5" data-testid="market-data-kr-operations">
      <Card className="px-5 py-4 hover:translate-y-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Yahoo Finance KR operations</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Provider operations preserve resolver previews, frozen scopes, retries, progress, and item outcomes for KR mapping work.
            </p>
          </div>
          <Link
            className="rounded border border-border px-3 py-2 text-sm font-medium"
            href={`/admin/market-data/KR/activity?source=yahoo_chart&category=provider_operation${selectedOperation ? `&search=${encodeURIComponent(selectedOperation.id)}` : ""}`}
            data-testid="provider-console-operation-open-activity"
          >
            Open activity
          </Link>
        </div>
        {message ? <p className="mt-4 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </Card>

      <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="provider-console-operations-table">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Operation history</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Operation</th>
                <th className="px-5 py-3">Phase</th>
                <th className="px-5 py-3">Scope</th>
                <th className="px-5 py-3">Preview</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {operationRows.map((operation) => (
                <tr key={operation.id}>
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-foreground">{operation.id}</td>
                  <td className="px-5 py-4">
                    <span className={cn("rounded-full px-2 py-1 text-xs font-medium", phaseTone[operation.phase])}>{operation.phase}</span>
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{operation.matchCount.toLocaleString()} matches</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {operation.preview.sampleCount.toLocaleString()} sample / {operation.preview.matchCount.toLocaleString()} matching
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => pushOperations({ operationId: operation.id, operationOutcomesPage: 1 })}
                        className={cn("rounded border border-border px-2 py-1 text-xs", selectedOperation?.id === operation.id && "bg-primary text-primary-foreground")}
                        data-testid={`provider-console-operation-select-${operation.id}`}
                      >
                        Inspect
                      </button>
                      {operation.canExecute ? (
                        <button
                          type="button"
                          onClick={() => pushOperations({ operationId: operation.id, operationOutcomesPage: 1 })}
                          className="rounded border border-border px-2 py-1 text-xs"
                          data-testid={`provider-console-operation-execute-review-${operation.id}`}
                        >
                          Execute
                        </button>
                      ) : null}
                      <button type="button" disabled={!operation.canPause || busyAction !== null} onClick={() => void controlOperation(operation, "pause")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Pause</button>
                      <button type="button" disabled={!operation.canResume || busyAction !== null} onClick={() => void controlOperation(operation, "resume")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Resume</button>
                      <button type="button" disabled={!operation.canRetry || busyAction !== null} onClick={() => void controlOperation(operation, "retry")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-operation-retry-${operation.id}`}>Retry</button>
                      <button type="button" disabled={!operation.canCancel || busyAction !== null} onClick={() => void controlOperation(operation, "cancel")} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 disabled:opacity-50">Cancel</button>
                    </div>
                  </td>
                </tr>
              ))}
              {operationRows.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-sm text-muted-foreground">No KR provider operations match this page.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4 text-sm">
          <Link className="rounded border border-border px-3 py-2" href={krOperationsPath({ ...data.query, operationId: selectedOperation?.id, operationsPage: Math.max(1, data.query.operationsPage - 1) })}>Previous</Link>
          <Link className="rounded border border-border px-3 py-2" href={krOperationsPath({ ...data.query, operationId: selectedOperation?.id, operationsPage: data.query.operationsPage + 1 })}>Next</Link>
        </div>
      </Card>

      {selectedOperation ? (
        <Card className="space-y-4 px-5 py-4 hover:translate-y-0" data-testid="provider-console-operation-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Operation inspector</h3>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{selectedOperation.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={cn("rounded-full px-2 py-1 text-xs font-medium", phaseTone[selectedOperation.phase])}>{selectedOperation.phase}</span>
              <span className={cn("rounded-full px-2 py-1 text-xs font-medium", selectedOperation.dangerous ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                {selectedOperation.dangerous ? "Dangerous" : "Small write"}
              </span>
            </div>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted-foreground">Provider</dt><dd className="mt-1 font-medium">{selectedOperation.providerId}</dd></div>
            <div><dt className="text-muted-foreground">Market</dt><dd className="mt-1 font-medium">{selectedOperation.market ?? "none"}</dd></div>
            <div><dt className="text-muted-foreground">Progress</dt><dd className="mt-1 font-medium">{selectedOperation.progressPercent ?? summary.progressPercent}%</dd></div>
            <div><dt className="text-muted-foreground">Frozen scope</dt><dd className="mt-1 font-medium">{selectedOperation.preview.frozenScope ? "available" : "missing"}</dd></div>
          </dl>
          {selectedOperation.canExecute ? (
            <div className="rounded border border-border bg-muted/20 p-4" data-testid="provider-console-operation-execute-guardrails">
              <h4 className="text-sm font-semibold text-foreground">Execute preview guardrails</h4>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className={cn("rounded border px-3 py-2", !selectedPreviewExpired ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
                  Token valid: {!selectedPreviewExpired ? "yes" : "expired"}
                </div>
                <div className={cn("rounded border px-3 py-2", selectedOperation.preview.frozenScope ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
                  Frozen scope: {selectedOperation.preview.frozenScope ? "available" : "missing"}
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  data-testid="provider-console-operation-confirm-checkbox"
                />
                I reviewed this operation preview and understand execution writes provider-owned KR mapping results.
              </label>
              {typedConfirmationRequired ? (
                <label className="mt-3 block text-sm font-medium text-foreground">
                  Type confirmation
                  <input
                    value={typedConfirmation}
                    onChange={(event) => setTypedConfirmation(event.target.value)}
                    placeholder={selectedOperation.preview.confirmationText ?? ""}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                    data-testid="provider-console-operation-typed-confirmation"
                  />
                </label>
              ) : null}
              <button
                type="button"
                disabled={executeDisabled}
                onClick={() => void executeOperation()}
                className="mt-3 rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
                data-testid="provider-console-operation-execute-button"
              >
                Execute operation
              </button>
            </div>
          ) : null}
          <div className="rounded border border-border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Operation item outcomes</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {summary.processed.toLocaleString()} processed of {summary.total.toLocaleString()} total; {summary.failed.toLocaleString()} failed.
                </p>
              </div>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  pushOperations({
                    operationId: selectedOperation.id,
                    operationOutcomesPage: 1,
                    operationOutcomeState: outcomeStateInput,
                    operationOutcomeAction: outcomeActionInput,
                  });
                }}
              >
                <select
                  value={outcomeStateInput}
                  onChange={(event) => setOutcomeStateInput(event.target.value as KrOperationsData["query"]["operationOutcomeState"])}
                  className="rounded border border-border bg-background px-3 py-2 text-sm"
                  data-testid="provider-console-operation-outcome-state"
                >
                  <option value="all">all states</option>
                  <option value="pending">pending</option>
                  <option value="running">running</option>
                  <option value="succeeded">succeeded</option>
                  <option value="failed">failed</option>
                  <option value="skipped">skipped</option>
                  <option value="rate_limited">rate limited</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <input
                  value={outcomeActionInput}
                  onChange={(event) => setOutcomeActionInput(event.target.value)}
                  placeholder="Action filter"
                  className="rounded border border-border bg-background px-3 py-2 text-sm"
                  data-testid="provider-console-operation-outcome-action"
                />
                <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Apply</button>
              </form>
            </div>
            <div className="mt-4 overflow-x-auto rounded border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="px-3 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.outcomes.items.map((outcome) => (
                    <tr key={`${outcome.operationId}:${outcome.sourceSymbol}:${outcome.action}`}>
                      <td className="px-3 py-2 font-mono">{outcome.sourceSymbol}</td>
                      <td className="px-3 py-2">{outcome.action}</td>
                      <td className="px-3 py-2">{outcome.state}</td>
                      <td className="px-3 py-2 text-muted-foreground">{outcome.message ?? outcome.errorCode ?? "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatTimestamp(outcome.updatedAt)}</td>
                    </tr>
                  ))}
                  {data.outcomes.items.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">No item outcomes match this operation filter.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-2 text-sm">
              <Link className="rounded border border-border px-3 py-2" href={krOperationsPath({ ...data.query, operationId: selectedOperation.id, operationOutcomesPage: Math.max(1, data.query.operationOutcomesPage - 1) })}>Previous outcomes</Link>
              <Link className="rounded border border-border px-3 py-2" href={krOperationsPath({ ...data.query, operationId: selectedOperation.id, operationOutcomesPage: data.query.operationOutcomesPage + 1 })}>Next outcomes</Link>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
