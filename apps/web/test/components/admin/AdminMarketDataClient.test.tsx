import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataOperationDto,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  ProviderFixerDashboardOperationDto,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemsResponse,
  ProviderUnresolvedListState,
} from "@vakwen/shared-types";
import type {
  AdminMarketDataActivityResponse,
  AdminMarketDataCalendarResponse,
} from "../../../lib/adminMarketDataContracts";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => vi.fn(() => new URLSearchParams()));
const mockIsSmallScreen = vi.hoisted(() => vi.fn(() => false));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => mockSearchParams(),
}));

vi.mock("../../../lib/hooks/use-small-screen", () => ({
  useIsSmallScreen: () => mockIsSmallScreen(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(async () => ({ preferences: {} })),
  patchJson: vi.fn(async () => ({ preferences: {} })),
}));

vi.mock("../../../lib/adminMarketDataService", () => ({
  confirmMarketCalendarImport: vi.fn(),
  executeMarketBackfill: vi.fn(),
  executeMarketSnapshotRepair: vi.fn(),
  executeProviderRepair: vi.fn(),
  executeMarketPurge: vi.fn(),
  fetchMarketValuationRepairStatus: vi.fn(),
  fetchOperationLogs: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 10 })),
  fetchOperationOutcomes: vi.fn(async () => ({
    items: [],
    summary: { total: 0, processed: 0, pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, rateLimited: 0, cancelled: 0, progressPercent: 0 },
    total: 0,
    page: 1,
    limit: 25,
  })),
  invalidateMarketCalendar: vi.fn(),
  bulkUpdateProviderUnresolvedState: vi.fn(),
  previewMarketCalendarImport: vi.fn(),
  previewProviderRepair: vi.fn(),
  previewMarketBackfill: vi.fn(),
  previewMarketPurge: vi.fn(),
  renewProviderEvidence: vi.fn(),
  rerunProviderResolvedUnresolvedItem: vi.fn(),
  mutateProviderOperation: vi.fn(),
  reverifyProviderMapping: vi.fn(),
  revertProviderMapping: vi.fn(),
  rerunProviderMapping: vi.fn(),
  updateMarketCalendarSource: vi.fn(),
  updateMarketCalendarSourceConfig: vi.fn(),
  updateMarketInstrumentSupportState: vi.fn(),
  updateProviderUnresolvedState: vi.fn(),
  updateMarketInstrumentDelistingOverride: vi.fn(),
}));

import { AdminMarketDataWorkspaceClient } from "../../../components/admin/AdminMarketDataClient";
import {
  bulkUpdateProviderUnresolvedState,
  executeMarketBackfill,
  executeMarketSnapshotRepair,
  executeMarketPurge,
  executeProviderRepair,
  fetchMarketValuationRepairStatus,
  confirmMarketCalendarImport,
  previewMarketBackfill,
  previewMarketCalendarImport,
  previewMarketPurge,
  previewProviderRepair,
  renewProviderEvidence,
  rerunProviderResolvedUnresolvedItem,
  mutateProviderOperation,
  reverifyProviderMapping,
  revertProviderMapping,
  rerunProviderMapping,
  updateMarketInstrumentDelistingOverride,
  updateProviderUnresolvedState,
} from "../../../lib/adminMarketDataService";
import { getJson, patchJson } from "../../../lib/api";

const updateMarketInstrumentDelistingOverrideMock = vi.mocked(updateMarketInstrumentDelistingOverride);
const bulkUpdateProviderUnresolvedStateMock = vi.mocked(bulkUpdateProviderUnresolvedState);
const updateProviderUnresolvedStateMock = vi.mocked(updateProviderUnresolvedState);
const executeProviderRepairMock = vi.mocked(executeProviderRepair);
const executeMarketBackfillMock = vi.mocked(executeMarketBackfill);
const executeMarketSnapshotRepairMock = vi.mocked(executeMarketSnapshotRepair);
const executeMarketPurgeMock = vi.mocked(executeMarketPurge);
const fetchMarketValuationRepairStatusMock = vi.mocked(fetchMarketValuationRepairStatus);
const confirmMarketCalendarImportMock = vi.mocked(confirmMarketCalendarImport);
const previewMarketBackfillMock = vi.mocked(previewMarketBackfill);
const previewMarketCalendarImportMock = vi.mocked(previewMarketCalendarImport);
const previewMarketPurgeMock = vi.mocked(previewMarketPurge);
const previewProviderRepairMock = vi.mocked(previewProviderRepair);
const renewProviderEvidenceMock = vi.mocked(renewProviderEvidence);
const rerunProviderResolvedUnresolvedItemMock = vi.mocked(rerunProviderResolvedUnresolvedItem);
const mutateProviderOperationMock = vi.mocked(mutateProviderOperation);
const reverifyProviderMappingMock = vi.mocked(reverifyProviderMapping);
const rerunProviderMappingMock = vi.mocked(rerunProviderMapping);
const revertProviderMappingMock = vi.mocked(revertProviderMapping);
const getJsonMock = vi.mocked(getJson);
const patchJsonMock = vi.mocked(patchJson);

const auBackfillDateRange = {
  requestedStartDate: "2026-06-12",
  requestedEndDate: "2026-06-15",
  effectiveStartDate: "2026-06-12",
  effectiveEndDate: "2026-06-15",
  providerStartDate: "1990-01-01",
  clampedStartDate: false,
};

function overview(): AdminMarketDataOverviewResponse {
  return {
    marketCode: "AU",
    label: "Australia",
	    tabs: ["overview", "instruments"],
	    providers: [{ providerId: "twelve-data-au", label: "Twelve Data AU", role: "Catalog evidence" }],
	    purgeCategories: [
	      { category: "price_bars", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "dividends", supported: true, disabledReasonCode: null, disabledReason: null },
	      {
	        category: "backfill_jobs",
	        supported: false,
	        disabledReasonCode: "backfill_jobs_not_target_safe",
	        disabledReason: "Refresh batch records are aggregate job history.",
	      },
	      { category: "provider_operation_outcomes", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "provider_error_trail", supported: true, disabledReasonCode: null, disabledReason: null },
	      {
	        category: "provider_resolution_mappings",
	        supported: false,
	        disabledReasonCode: "kr_mappings_only",
	        disabledReason: "Only KR Yahoo mappings support durable provider mappings.",
	      },
	      { category: "asx_gics_enrichment", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "admin_state_reset", supported: true, disabledReasonCode: null, disabledReason: null },
	    ],
	    healthStatus: "healthy",
    unresolvedCount: 0,
    pendingBackfillCount: 1,
    failedBackfillCount: 0,
    latestOperation: null,
    guidance: [],
  };
}

function instruments(ticker: string, name: string): AdminMarketDataInstrumentsResponse {
  return {
    marketCode: "AU",
    items: [
      {
        ticker,
        marketCode: "AU",
        name,
        instrumentType: "STOCK",
        status: "listed",
        supportState: "supported",
        statusReason: null,
        absenceStreak: 0,
        lastSeenInCatalogAt: "2026-01-01T00:00:00.000Z",
        delistedAt: null,
        delistingDetectionExcluded: false,
        providerIds: ["twelve-data-au"],
        backfillStatus: "pending",
      },
    ],
    total: 1,
    page: 1,
    limit: 50,
    thresholds: {
      catalogAbsenceThreshold: 3,
      catalogAbsenceGuardPercent: 1,
      catalogAbsenceGuardFloor: 20,
    },
    filters: {
      status: ["all", "listed", "delisted", "excluded"],
      supportState: ["all", "supported", "retired_by_admin", "unsupported_by_provider"],
      backfillStatus: ["all", "pending", "backfilling", "ready", "failed"],
      instrumentType: ["all", "STOCK", "ETF", "BOND_ETF"],
      sort: ["ticker_asc", "ticker_desc", "updated_desc", "updated_asc"],
    },
  };
}

function actions(): AdminMarketDataActionsResponse["actions"] {
  return [];
}

function backfillActions(): AdminMarketDataActionsResponse["actions"] {
  return [
    {
      action: "backfill_catalog_rows",
      providerId: "yahoo-finance-au",
      label: "Backfill catalog rows",
      description: "Backfill provider-owned bars and dividends.",
      supported: true,
      disabledReason: null,
      guardrail: "typed_preview",
      providerBudgetNotes: ["Preview freezes exact targets."],
    },
  ];
}

function krOverview(): AdminMarketDataOverviewResponse {
  return {
    marketCode: "KR",
    label: "Korea",
    tabs: ["overview", "instruments", "backfill", "mappings", "purge", "operations", "activity"],
	    providers: [
	      { providerId: "twelve-data-kr", label: "Twelve Data KR", role: "Catalog evidence" },
	      { providerId: "yahoo-finance-kr", label: "Yahoo Finance KR", role: "Mappings, bars, dividends" },
	    ],
	    purgeCategories: [
	      { category: "price_bars", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "dividends", supported: true, disabledReasonCode: null, disabledReason: null },
	      {
	        category: "backfill_jobs",
	        supported: false,
	        disabledReasonCode: "backfill_jobs_not_target_safe",
	        disabledReason: "Refresh batch records are aggregate job history.",
	      },
	      { category: "provider_operation_outcomes", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "provider_error_trail", supported: true, disabledReasonCode: null, disabledReason: null },
	      { category: "provider_resolution_mappings", supported: true, disabledReasonCode: null, disabledReason: null },
	      {
	        category: "asx_gics_enrichment",
	        supported: false,
	        disabledReasonCode: "au_gics_only",
	        disabledReason: "ASX GICS enrichment is AU-only.",
	      },
	      { category: "admin_state_reset", supported: true, disabledReasonCode: null, disabledReason: null },
	    ],
	    healthStatus: "awaiting",
    unresolvedCount: 1,
    pendingBackfillCount: 0,
    failedBackfillCount: 0,
    latestOperation: null,
    guidance: ["KR mapping repair only persists verified mappings. Backfill is a separate explicit action."],
  };
}

function krActions(): AdminMarketDataActionsResponse["actions"] {
  return [
    {
      action: "repair_mapping",
      providerId: "yahoo-finance-kr",
      label: "Repair KR mappings",
      description: "Persist verified Yahoo Finance KR mappings only; backfill remains a separate action.",
      supported: true,
      disabledReason: null,
      guardrail: "typed_preview",
      providerBudgetNotes: ["Mapping repair does not enqueue historical bars or dividends."],
    },
  ];
}

function operation(id: string): ProviderFixerDashboardOperationDto {
  return {
    id,
    providerId: "yahoo-finance-kr",
    market: "KR",
    phase: "preview",
    matchCount: 1,
    preview: {
      scopeType: "selected_items",
      scopeLabel: "selected",
      queryBacked: true,
      page: 1,
      totalPages: 1,
      token: "preview-token",
      tokenExpiresAt: "2999-01-01T00:00:00.000Z",
      snapshotHash: "snapshot",
      matchCount: 1,
      sampleCount: 1,
      confirmationMode: "standard",
      confirmationText: null,
      acknowledgementLabel: "Acknowledge",
      scopeSummary: "1 selected unresolved row",
      search: null,
      state: "active",
      frozenScope: {
        type: "selected_items",
        filterFingerprint: "selected",
        matchCount: 1,
        selectedItems: [{
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          sourceSymbol: "005930",
        }],
        filter: null,
      },
      evidenceSample: [{
        symbol: "005930",
        providerSymbol: "005930",
        candidateSymbol: "005930.KS",
        exchangeHint: "quote strict",
        verificationStatus: "verified",
        note: "strict quote match",
      }],
    },
    canExecute: true,
    canPause: false,
    canResume: false,
    canCancel: true,
    canRetry: false,
    dangerous: false,
    progressPercent: null,
    autoPauseFailureCount: null,
    autoPauseFailureThresholdPerMinute: null,
    effectiveRateCapPerMinute: null,
  };
}

function marketOperation(id: string, overrides: Partial<AdminMarketDataOperationDto> = {}): AdminMarketDataOperationDto {
  const providerOperation = operation(id);
  return {
    id,
    providerId: providerOperation.providerId,
    market: "KR",
    marketCode: "KR",
    operationType: "repair_mapping",
    phase: providerOperation.phase,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:01:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    matchCount: providerOperation.matchCount,
    progressPercent: providerOperation.progressPercent,
    previewExpiresAt: providerOperation.preview.tokenExpiresAt,
    canPause: providerOperation.canPause,
    canResume: providerOperation.canResume,
    canCancel: providerOperation.canCancel,
    execute: {
      canExecute: providerOperation.canExecute,
      executeMode: "direct",
      confirmationLevel: "checkbox",
      confirmationText: null,
      acknowledgementLabel: "I reviewed this operation preview and understand execution writes provider-owned KR mapping results.",
      previewToken: providerOperation.preview.token,
      previewExpired: false,
      blockedReason: null,
      endpoint: "provider_operation",
    },
    summary: {
      kind: "repair_mapping",
      previewParts: [{ kind: "scope", value: providerOperation.preview.scopeSummary }],
      counts: { matchCount: providerOperation.matchCount, succeeded: 0, failed: 0 },
      dateRange: null,
      batchId: null,
      categories: [],
      rateLimit: { requestsPerMinute: 250 },
      pacing: { minRequestIntervalMs: 1500, enforced: true },
	    },
	    details: {
	      kind: "mapping",
	      operationType: "repair_mapping",
	      fields: {
	        mappingSourceSymbol: "005930",
	        mappingResolvedSymbol: "005930.KS",
	        resolverMode: "quote_first",
	      },
	    },
    debug: {
      snapshotHash: providerOperation.preview.snapshotHash,
    },
    outcomes: {
      available: true,
      reason: null,
    },
    ...overrides,
  };
}

function krUnresolved(): ProviderUnresolvedItemsResponse {
  return {
    items: [
      {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        sourceSymbol: "005930",
        providerSymbol: "005930",
        state: "active",
        severity: "warning",
        occurrenceCount: 4,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-02T00:00:00.000Z",
        lastErrorTrailId: 12,
        evidence: null,
        resolvedAt: null,
        resolvedByOperationId: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 25,
  };
}

function krMappings(): ProviderResolutionMappingsResponse {
  return {
    items: [
      {
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        sourceSymbol: "005930",
        resolvedSymbol: "005930.KS",
        resolverMode: "quote_first",
        evidence: { operationId: "OP-20260602-1842", note: "strict quote match" },
        verifiedAt: "2026-01-02T00:00:00.000Z",
        verifiedByUserId: "admin",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 25,
  };
}

function krMappingData() {
  return {
    unresolved: krUnresolved(),
    mappings: krMappings(),
    query: {
      resolverMode: "quote_first" as const,
      unresolvedPage: 1,
      unresolvedLimit: 25,
      unresolvedState: "active" as ProviderUnresolvedListState,
      unresolvedSearch: "",
      unresolvedSort: "last_seen_desc" as const,
      mappingsPage: 1,
      mappingsLimit: 25,
      mappingsSearch: "",
    },
  };
}

function krOperationsData() {
  const selected = marketOperation("OP-PREVIEW");
  const operations: AdminMarketDataOperationsResponse = {
    marketCode: "KR",
    providers: [{ providerId: "yahoo-finance-kr", label: "Yahoo Finance KR", role: "Mappings, bars, dividends" }],
    selectedOperation: null,
    selectedOperationIsOffPage: false,
    items: [selected],
	    filters: {
	      providerId: null,
	      operationType: null,
	      phase: null,
	      search: null,
	      from: null,
	      to: null,
	    },
	    availableFilters: {
	      operationTypes: ["repair_mapping", "renew_evidence"],
	      phases: ["completed", "preview"],
	    },
	    total: 1,
    page: 1,
    limit: 25,
  };
  const outcomes: ProviderOperationOutcomesResponse = {
    items: [
      {
        operationId: selected.id,
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        sourceSymbol: "005930",
        providerSymbol: "005930.KS",
        action: "repair_mapping",
        state: "succeeded",
        message: "Mapping persisted",
        errorCode: null,
        jobId: "job-1",
        evidence: { operationId: selected.id },
        startedAt: "2026-01-02T00:00:00.000Z",
        completedAt: "2026-01-02T00:01:00.000Z",
        updatedAt: "2026-01-02T00:01:00.000Z",
      },
    ],
    summary: {
      total: 1,
      processed: 1,
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      rateLimited: 0,
      cancelled: 0,
      progressPercent: 100,
    },
    total: 1,
    page: 1,
    limit: 25,
  };
  return {
    operations,
    explicitOperationId: "",
    selectedOperationId: "",
    outcomes,
    query: {
      operationsPage: 1,
      operationsLimit: 25,
      operationOutcomesPage: 1,
      operationOutcomesLimit: 25,
      operationOutcomeState: "all" as const,
      operationOutcomeAction: "",
    },
  };
}

function auOperations(): AdminMarketDataOperationsResponse {
  return {
    marketCode: "AU",
    providers: [
      { providerId: "twelve-data-au", label: "Twelve Data AU", role: "Catalog" },
      { providerId: "yahoo-finance-au", label: "Yahoo Finance AU", role: "Bars, dividends, metadata" },
      { providerId: "asx-gics-csv", label: "ASX GICS CSV", role: "GICS enrichment" },
    ],
    items: [marketOperation("OP-AU", {
      providerId: "yahoo-finance-au",
      market: "AU",
      marketCode: "AU",
      operationType: "backfill_catalog_rows",
      phase: "completed",
      execute: {
        ...marketOperation("OP-AU").execute,
        canExecute: false,
        executeMode: "none",
        confirmationLevel: "none",
        previewToken: null,
      },
      outcomes: {
        available: false,
        reason: null,
      },
    })],
    selectedOperation: null,
    selectedOperationIsOffPage: false,
	    filters: {
	      providerId: null,
	      operationType: null,
	      phase: null,
	      search: null,
	      from: null,
	      to: null,
	    },
	    availableFilters: {
	      operationTypes: ["backfill_catalog_rows", "purge_market_data"],
	      phases: ["completed", "preview"],
	    },
	    total: 1,
    page: 1,
    limit: 25,
  };
}

function activityResponse(): AdminMarketDataActivityResponse {
  const response: AdminMarketDataActivityResponse & {
    filters: {
      categories: string[];
      results: string[];
      sourceKinds: string[];
    };
  } = {
    marketCode: "AU",
    providers: [{ providerId: "asx-gics-csv", label: "ASX GICS CSV", role: "Operations" }],
    summary: [{ id: "warnings", label: "Warnings", value: 2, detail: "1 delayed bar, 1 calendar warning" }],
    yahooChartSummary: {
      label: "Yahoo chart",
      lastRequestAt: "2026-06-19T04:12:00.000Z",
      successCount: 4,
      delayedCount: 1,
      rateLimitedCount: 0,
      errorCount: 0,
      budgetUsed: 10,
      budgetLimit: 120,
      filterPatch: {
        source: "yahoo_chart",
        category: "intraday_price",
        result: "all",
        timeRange: "24h",
      },
    },
    filters: {
      categories: ["intraday_price", "calendar"],
      results: ["success", "warning", "error", "skipped", "rate_limited"],
      sourceKinds: ["yahoo_chart", "official_calendar"],
    },
    availableFilters: {
      sources: [{ value: "yahoo_chart", label: "Yahoo chart" }],
      categories: [{ value: "intraday_price", label: "Intraday price" }],
      results: [{ value: "warning,error", label: "Warnings and errors" }],
      timeRanges: [{ value: "24h", label: "Last 24h" }],
    },
    retentionNote: "Detailed intraday events retained 7 days.",
    items: [{
      id: "act-1",
      occurredAt: "2026-06-19T04:14:08.000Z",
      category: "intraday_price",
      source: "yahoo_chart",
      sourceId: "yahoo-finance-chart",
      sourceLabel: "Yahoo chart",
      subject: "BHP.AX",
      subjectDetail: "job au:bhp",
      result: "warning",
      facts: "bar 12:01 Australia/Sydney - delay 13m",
      detailRows: [{ label: "Event id", value: "act-1" }],
      timeline: [{ at: "2026-06-19T04:13:58.000Z", message: "queued by dashboard enrichment read" }],
      metadata: { budgetRemaining: 110 },
    }],
    total: 1,
    page: 1,
    limit: 25,
    query: { page: 1, limit: 25, search: "", source: "", sourceKind: "yahoo_chart", sourceId: "yahoo-finance-chart", category: "intraday_price", result: "warning,error", timeRange: "24h" },
  };
  return response;
}

function calendarResponse(): AdminMarketDataCalendarResponse {
  return {
    marketCode: "AU",
    years: [{
      calendarYear: 2026,
      status: "confirmed",
      sourceLabel: "ASX official calendar",
      updatedAt: "2026-06-19T00:00:00.000Z",
      note: "Current year confirmed.",
    }],
    sources: [{
      sourceId: "asx-official",
      label: "ASX official calendar",
      sourceType: "official_source",
      suggestedSourceUrl: "https://www.asx.com.au/markets/trade-our-cash-market/directory",
      isDefault: true,
    }],
    activeCalendars: [{
      marketCode: "AU",
      calendarYear: 2026,
      versionId: "calendar-version-1",
      importOperationId: "import-op-1",
      sourceLabel: "ASX official calendar",
      sourceType: "official_source",
      sourceUrl: "https://www.asx.com.au/markets/trade-our-cash-market/directory",
      retrievedAt: "2026-06-18T23:00:00.000Z",
      confirmedAt: "2026-06-19T00:00:00.000Z",
      annualCounts: {
        tradingDayCount: 251,
        nonTradingDayCount: 114,
        weekdayClosedCount: 10,
        weekendOpenCount: 1,
      },
      coverage: {
        scope: "full_year",
        evidence: "Official ASX calendar checked.",
      },
      exceptions: [{
        date: "2026-01-01",
        status: "closed",
        name: "New Year's Day",
        evidence: "Official ASX holiday notice",
        overrideReason: "Official holiday closure.",
        notes: null,
      }, {
        date: "2026-01-03",
        status: "open",
        name: "Special Saturday session",
        evidence: "Official ASX special session notice",
        overrideReason: "Official weekend trading session.",
        notes: "Half-day",
      }],
    }],
    history: [{
      id: "hist-1",
      importOperationId: "import-op-1",
      calendarYear: 2026,
      sourceLabel: "ASX official calendar",
      importedAt: "2026-06-19T00:00:00.000Z",
      status: "confirmed",
    }],
  };
}

function updateInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function updateTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AdminMarketDataWorkspaceClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockRefresh.mockClear();
    mockSearchParams.mockReturnValue(new URLSearchParams());
    window.history.pushState({}, "", "/");
    mockIsSmallScreen.mockReturnValue(false);
    getJsonMock.mockResolvedValue({ preferences: {} });
    patchJsonMock.mockResolvedValue({ preferences: {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders market data tabs as a mobile select and desktop tab links", async () => {
	    await act(async () => {
	      root.render(
	        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="calendar"
          overview={{ ...overview(), tabs: ["overview", "calendar", "instruments", "activity"] as never }}
          actions={actions()}
          instruments={instruments("BHP", "BHP Group")}
          operations={null}
          activity={activityResponse()}
          calendar={calendarResponse()}
          krMappings={null}
        />,
      );
    });

    expect(container.querySelector("[data-testid='admin-market-data-mobile-tabs']")).not.toBeNull();
    expect(container.querySelector("nav[aria-label='Market data tabs']")?.textContent).toContain("Calendar");
    expect(container.querySelector("a[href='/admin/market-data/AU/activity']")).not.toBeNull();
  });

  it("previews and executes selected supported instruments with a frozen backfill token", async () => {
    previewMarketBackfillMock.mockResolvedValueOnce({
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      operationId: "OP-BACKFILL-PREVIEW",
      previewToken: "BF-TOKEN",
      tokenExpiresAt: "2999-01-01T00:00:00.000Z",
      matchCount: 1,
      affectedUserCount: 0,
      affectedAccountCount: 0,
      estimatedJobCount: 1,
      estimatedStorageRows: 2,
      dateRange: auBackfillDateRange,
      providerBudgetNotes: ["Preview freezes exact targets."],
      targets: [{
        ticker: "AUBF1",
        marketCode: "AU",
        name: "AU Backfill Fixture",
        instrumentType: "STOCK",
        status: "listed",
        supportState: "supported",
        backfillStatus: "pending",
        providerIds: ["yahoo-finance-au"],
      }],
      unsupportedRows: [],
      confirmation: {
        level: "checkbox",
        text: null,
        reason: "Preview is required before enqueue.",
      },
    });
    executeMarketBackfillMock.mockResolvedValueOnce({
      operationId: "OP-BACKFILL-PREVIEW",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      status: "completed",
      matchCount: 1,
      dateRange: auBackfillDateRange,
      enqueuedJobCount: 0,
      skippedExistingJobCount: 0,
      batchId: null,
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF1", "AU Backfill Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
        />,
      );
    });

    const modeSelect = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      modeSelect.value = "supported";
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rowCheckbox = container.querySelector("input[aria-label='Select AUBF1']") as HTMLInputElement;
    await act(async () => {
      rowCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview selected")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(previewMarketBackfillMock).toHaveBeenCalledWith("AU", expect.objectContaining({
      scope: "selected_catalog_rows",
      providerId: "yahoo-finance-au",
      selectedCatalogRows: [expect.objectContaining({ ticker: "AUBF1", marketCode: "AU" })],
    }));
    expect(container.textContent).toContain("Frozen targets: 1");
    expect(container.textContent).toContain("AUBF1");

    const acknowledge = [...container.querySelectorAll("input[type='checkbox']")]
      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("I reviewed the preview")) as HTMLInputElement;
    await act(async () => {
      acknowledge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Execute backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeMarketBackfillMock).toHaveBeenCalledWith("AU", {
      operationId: "OP-BACKFILL-PREVIEW",
      previewToken: "BF-TOKEN",
      acknowledged: true,
      typedConfirmation: "",
    });
    expect(container.querySelector("[data-testid='market-data-backfill-created-notice']")?.textContent)
      .toContain("Backfill job created");
    expect(container.textContent).toContain("Operation OP-BACKFILL-PREVIEW is completed");
  });

  it("shows an inline error when backfill preview fails", async () => {
    previewMarketBackfillMock.mockRejectedValueOnce(new Error("internal_error"));

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF1", "AU Backfill Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
        />,
      );
    });

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview owned or monitored")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='market-data-backfill-preview-error']")?.textContent)
      .toContain("internal_error");
    expect(container.textContent).not.toContain("Frozen targets");
  });

  it("drives guided valuation repair from bounded backfill status and queues only eligible snapshots", async () => {
    fetchMarketValuationRepairStatusMock
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF1",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["latest_bar_before_target"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 0, blocked: 1 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: {
          operationId: "OP-GUIDED-BACKFILL",
          phase: "completed",
          progressPercent: 100,
          enqueuedJobCount: 1,
          skippedExistingJobCount: 0,
          completedAt: "2026-06-16T00:00:00.000Z",
        },
        tickers: [{
          ticker: "AUBF1",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: true,
          completed: false,
          reasons: ["ready", "snapshot_stale"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 1, completed: 0, blocked: 0 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF1",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-15",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: true,
          reasons: ["snapshot_ready"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 1, blocked: 0 },
      });
    previewMarketBackfillMock.mockResolvedValueOnce({
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      operationId: "OP-GUIDED-BACKFILL",
      previewToken: "GUIDED-TOKEN",
      tokenExpiresAt: "2999-01-01T00:00:00.000Z",
      matchCount: 1,
      affectedUserCount: 1,
      affectedAccountCount: 1,
      estimatedJobCount: 1,
      estimatedStorageRows: 2,
      dateRange: auBackfillDateRange,
      providerBudgetNotes: ["Preview freezes exact targets."],
      targets: [{
        ticker: "AUBF1",
        marketCode: "AU",
        name: "AU Backfill Fixture",
        instrumentType: "STOCK",
        status: "listed",
        supportState: "supported",
        backfillStatus: "pending",
        providerIds: ["yahoo-finance-au"],
      }],
      unsupportedRows: [],
      confirmation: { level: "checkbox", text: null, reason: "Preview is required before enqueue." },
    });
    executeMarketBackfillMock.mockResolvedValueOnce({
      operationId: "OP-GUIDED-BACKFILL",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      status: "completed",
      matchCount: 1,
      dateRange: auBackfillDateRange,
      enqueuedJobCount: 1,
      skippedExistingJobCount: 0,
      batchId: null,
    });
    executeMarketSnapshotRepairMock.mockResolvedValueOnce({
      marketCode: "AU",
      queued: ["AUBF1"],
      rejected: [],
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF1", "AU Backfill Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
          snapshotRepairRequest={{
            mode: "valuation",
            tickers: ["AUBF1"],
            fromDate: "2026-06-12",
            targetDate: "2026-06-15",
            startDate: "2026-06-12",
            endDate: "2026-06-15",
          }}
        />,
      );
    });
    await act(async () => undefined);

    expect(container.textContent).toContain("Guided valuation repair");
    expect(container.textContent).toContain("Latest bar is before target");

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview guided backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(previewMarketBackfillMock).toHaveBeenCalledWith("AU", expect.objectContaining({
      scope: "selected_catalog_rows",
      providerId: "yahoo-finance-au",
      selectedCatalogRows: [{ ticker: "AUBF1", marketCode: "AU" }],
      startDate: "2026-06-12",
      endDate: "2026-06-15",
    }));
    expect(container.textContent).toContain("Effective start");

    const acknowledge = [...container.querySelectorAll("input[type='checkbox']")]
      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("I reviewed the preview")) as HTMLInputElement;
    await act(async () => {
      acknowledge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Execute backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMarketValuationRepairStatusMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF1"],
      targetDate: "2026-06-15",
      operationId: "OP-GUIDED-BACKFILL",
    });
    expect(executeMarketSnapshotRepairMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF1"],
      fromDate: "2026-06-12",
    });
  });

  it("polls guided valuation repair until async backfill reaches a terminal status", async () => {
    vi.useFakeTimers();
    fetchMarketValuationRepairStatusMock
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF2",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["latest_bar_before_target"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 0, blocked: 1 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: {
          operationId: "OP-GUIDED-RUNNING",
          phase: "running",
          progressPercent: 50,
          enqueuedJobCount: 1,
          skippedExistingJobCount: 0,
          completedAt: null,
        },
        tickers: [{
          ticker: "AUBF2",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["latest_bar_before_target"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 0, blocked: 1 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: {
          operationId: "OP-GUIDED-RUNNING",
          phase: "completed",
          progressPercent: 100,
          enqueuedJobCount: 1,
          skippedExistingJobCount: 0,
          completedAt: "2026-06-16T00:00:00.000Z",
        },
        tickers: [{
          ticker: "AUBF2",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: true,
          completed: false,
          reasons: ["ready", "snapshot_stale"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 1, completed: 0, blocked: 0 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF2",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-15",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: true,
          reasons: ["snapshot_ready"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 1, blocked: 0 },
      });
    previewMarketBackfillMock.mockResolvedValueOnce({
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      operationId: "OP-GUIDED-RUNNING",
      previewToken: "GUIDED-RUNNING-TOKEN",
      tokenExpiresAt: "2999-01-01T00:00:00.000Z",
      matchCount: 1,
      affectedUserCount: 1,
      affectedAccountCount: 1,
      estimatedJobCount: 1,
      estimatedStorageRows: 2,
      dateRange: auBackfillDateRange,
      providerBudgetNotes: ["Preview freezes exact targets."],
      targets: [{
        ticker: "AUBF2",
        marketCode: "AU",
        name: "AU Async Backfill Fixture",
        instrumentType: "STOCK",
        status: "listed",
        supportState: "supported",
        backfillStatus: "pending",
        providerIds: ["yahoo-finance-au"],
      }],
      unsupportedRows: [],
      confirmation: { level: "checkbox", text: null, reason: "Preview is required before enqueue." },
    });
    executeMarketBackfillMock.mockResolvedValueOnce({
      operationId: "OP-GUIDED-RUNNING",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      status: "queued",
      matchCount: 1,
      dateRange: auBackfillDateRange,
      enqueuedJobCount: 1,
      skippedExistingJobCount: 0,
      batchId: null,
    });
    executeMarketSnapshotRepairMock.mockResolvedValueOnce({
      marketCode: "AU",
      queued: ["AUBF2"],
      rejected: [],
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF2", "AU Async Backfill Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
          snapshotRepairRequest={{
            mode: "valuation",
            tickers: ["AUBF2"],
            fromDate: "2026-06-12",
            targetDate: "2026-06-15",
            startDate: "2026-06-12",
            endDate: "2026-06-15",
          }}
        />,
      );
    });
    await act(async () => undefined);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview guided backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const acknowledge = [...container.querySelectorAll("input[type='checkbox']")]
      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("I reviewed the preview")) as HTMLInputElement;
    await act(async () => {
      acknowledge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Execute backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeMarketSnapshotRepairMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(fetchMarketValuationRepairStatusMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF2"],
      targetDate: "2026-06-15",
      operationId: "OP-GUIDED-RUNNING",
    });
    expect(executeMarketSnapshotRepairMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF2"],
      fromDate: "2026-06-12",
    });
  });

  it("keeps polling guided repair when execution only skipped an existing backfill job", async () => {
    vi.useFakeTimers();
    fetchMarketValuationRepairStatusMock
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["latest_bar_before_target"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 0, blocked: 1 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: {
          operationId: "OP-GUIDED-SKIPPED",
          phase: "completed",
          progressPercent: 100,
          enqueuedJobCount: 0,
          skippedExistingJobCount: 1,
          completedAt: "2026-06-16T00:00:00.000Z",
        },
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-12",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["latest_bar_before_target"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 0, blocked: 1 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: {
          operationId: "OP-GUIDED-SKIPPED",
          phase: "completed",
          progressPercent: 100,
          enqueuedJobCount: 0,
          skippedExistingJobCount: 1,
          completedAt: "2026-06-16T00:00:00.000Z",
        },
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: true,
          completed: false,
          reasons: ["ready", "snapshot_stale"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 1, completed: 0, blocked: 0 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-15",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: true,
          reasons: ["snapshot_ready"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 1, blocked: 0 },
      });
    previewMarketBackfillMock.mockResolvedValueOnce({
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      operationId: "OP-GUIDED-SKIPPED",
      previewToken: "GUIDED-SKIPPED-TOKEN",
      tokenExpiresAt: "2999-01-01T00:00:00.000Z",
      matchCount: 1,
      affectedUserCount: 1,
      affectedAccountCount: 1,
      estimatedJobCount: 1,
      estimatedStorageRows: 2,
      dateRange: auBackfillDateRange,
      providerBudgetNotes: ["Preview freezes exact targets."],
      targets: [{
        ticker: "AUBF3",
        marketCode: "AU",
        name: "AU Existing Backfill Fixture",
        instrumentType: "STOCK",
        status: "listed",
        supportState: "supported",
        backfillStatus: "pending",
        providerIds: ["yahoo-finance-au"],
      }],
      unsupportedRows: [],
      confirmation: { level: "checkbox", text: null, reason: "Preview is required before enqueue." },
    });
    executeMarketBackfillMock.mockResolvedValueOnce({
      operationId: "OP-GUIDED-SKIPPED",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      scope: "selected_catalog_rows",
      status: "completed",
      matchCount: 1,
      dateRange: auBackfillDateRange,
      enqueuedJobCount: 0,
      skippedExistingJobCount: 1,
      batchId: null,
    });
    executeMarketSnapshotRepairMock.mockResolvedValueOnce({
      marketCode: "AU",
      queued: ["AUBF3"],
      rejected: [],
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF3", "AU Existing Backfill Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
          snapshotRepairRequest={{
            mode: "valuation",
            tickers: ["AUBF3"],
            fromDate: "2026-06-12",
            targetDate: "2026-06-15",
            startDate: "2026-06-12",
            endDate: "2026-06-15",
          }}
        />,
      );
    });
    await act(async () => undefined);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview guided backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const acknowledge = [...container.querySelectorAll("input[type='checkbox']")]
      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("I reviewed the preview")) as HTMLInputElement;
    await act(async () => {
      acknowledge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Execute backfill")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeMarketSnapshotRepairMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(fetchMarketValuationRepairStatusMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF3"],
      targetDate: "2026-06-15",
      operationId: "OP-GUIDED-SKIPPED",
    });
    expect(executeMarketSnapshotRepairMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF3"],
      fromDate: "2026-06-12",
    });
  });

  it("polls snapshot readiness after a guided snapshot repair is queued", async () => {
    vi.useFakeTimers();
    fetchMarketValuationRepairStatusMock
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: true,
          completed: false,
          reasons: ["ready", "snapshot_stale"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 1, completed: 0, blocked: 0 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-12",
          scopeCount: 1,
          eligibleForSnapshotRepair: true,
          completed: false,
          reasons: ["ready", "snapshot_stale"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 1, completed: 0, blocked: 0 },
      })
      .mockResolvedValueOnce({
        marketCode: "AU",
        targetRepairDate: "2026-06-15",
        marketTradingDay: true,
        operation: null,
        tickers: [{
          ticker: "AUBF3",
          marketCode: "AU",
          targetRepairDate: "2026-06-15",
          latestBarDate: "2026-06-15",
          latestSnapshotDate: "2026-06-15",
          scopeCount: 1,
          eligibleForSnapshotRepair: false,
          completed: true,
          reasons: ["snapshot_ready"],
        }],
        summary: { total: 1, eligibleForSnapshotRepair: 0, completed: 1, blocked: 0 },
      });
    executeMarketSnapshotRepairMock.mockResolvedValueOnce({
      marketCode: "AU",
      queued: ["AUBF3"],
      rejected: [],
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="backfill"
          overview={{ ...overview(), tabs: ["overview", "instruments", "backfill"] }}
          actions={backfillActions()}
          instruments={instruments("AUBF3", "AU Snapshot Poll Fixture")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "listed",
            supportState: "supported",
            search: "",
            instrumentType: "all",
            backfillStatus: "pending",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
          snapshotRepairRequest={{
            mode: "valuation",
            tickers: ["AUBF3"],
            fromDate: "2026-06-12",
            targetDate: "2026-06-15",
            startDate: "2026-06-12",
            endDate: "2026-06-15",
          }}
        />,
      );
    });
    await act(async () => undefined);

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Queue 1 eligible snapshot repair")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeMarketSnapshotRepairMock).toHaveBeenCalledWith("AU", {
      tickers: ["AUBF3"],
      fromDate: "2026-06-12",
    });
    expect(container.textContent).toContain("Repair status: 0/1 complete");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(fetchMarketValuationRepairStatusMock).toHaveBeenLastCalledWith("AU", {
      tickers: ["AUBF3"],
      targetDate: "2026-06-15",
      operationId: undefined,
    });
    expect(container.textContent).toContain("Repair status: 1/1 complete");
  });

  it("executes purge against the previewed request and clears stale previews when controls change", async () => {
    previewMarketPurgeMock.mockResolvedValue({
      operationId: "OP-PURGE-PREVIEW",
      previewToken: "purge-token",
      tokenExpiresAt: "2026-06-01T00:30:00.000Z",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      categories: ["price_bars"],
      affectedInstrumentCount: 1,
      affectedUserCount: 0,
      affectedAccountCount: 0,
      estimatedRows: 5,
      unsupportedCategories: [],
      linkedRefill: { available: true, mode: "full_history", warning: null },
      confirmation: { level: "typed", text: "PURGE AU", reason: null },
    });
    executeMarketPurgeMock.mockResolvedValueOnce({
      operationId: "OP-PURGE",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      status: "completed",
      categories: ["price_bars"],
      affectedInstrumentCount: 1,
      deletedRows: 5,
      linkedBackfillOperationId: null,
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="purge"
          overview={{ ...overview(), tabs: ["overview", "purge"] }}
          actions={actions()}
          instruments={null}
          operations={null}
          krMappings={null}
	        />,
	      );
	    });
	    const backfillHistoryCheckbox = [...container.querySelectorAll("input[type='checkbox']")]
	      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("Backfill job history")) as HTMLInputElement;
	    const mappingCheckbox = [...container.querySelectorAll("input[type='checkbox']")]
	      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("Provider resolution mappings")) as HTMLInputElement;
	    const asxGicsCheckbox = [...container.querySelectorAll("input[type='checkbox']")]
	      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("ASX GICS enrichment")) as HTMLInputElement;
	    expect(backfillHistoryCheckbox.disabled).toBe(true);
	    expect(mappingCheckbox.disabled).toBe(true);
	    expect(asxGicsCheckbox.disabled).toBe(false);
	    expect(container.textContent).toContain("Backfill job history is aggregate-only and is not target-safe to purge.");

	    const refillCheckbox = [...container.querySelectorAll("input[type='checkbox']")]
	      .find((input) => (input as HTMLInputElement).parentElement?.textContent?.includes("Enqueue backfill")) as HTMLInputElement;
    await act(async () => {
      refillCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview purge")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
	    expect(previewMarketPurgeMock).toHaveBeenCalledWith("AU", expect.objectContaining({
	      categories: ["price_bars"],
	      fullHistory: true,
	      enqueueBackfillAfterPurge: true,
	    }));
	    expect(container.textContent).toContain("Purge preview is ready.");
	    expect((container.querySelector("a[href='/admin/market-data/AU/operations?operationId=OP-PURGE-PREVIEW']") as HTMLAnchorElement | null)?.textContent).toBe("Open operation");

	    await act(async () => {
	      refillCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Purge estimate");
    await act(async () => {
      refillCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Preview purge")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmation = container.querySelector("input[placeholder='PURGE AU']") as HTMLInputElement;
    updateInputValue(confirmation, "PURGE AU");
    await act(async () => undefined);
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Execute purge")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

	    expect(executeMarketPurgeMock).toHaveBeenCalledWith("AU", {
	      operationId: "OP-PURGE-PREVIEW",
	      previewToken: "purge-token",
	      typedConfirmation: "PURGE AU",
	    });
	    expect(container.textContent).toContain("Purge operation completed.");
	    expect((container.querySelector("a[href='/admin/market-data/AU/operations?operationId=OP-PURGE']") as HTMLAnchorElement | null)?.textContent).toBe("Open operation");
	  });

  it("preserves KR unresolved filters, row lifecycle action, and repair preview under market-data mappings", async () => {
    updateProviderUnresolvedStateMock.mockResolvedValueOnce({
      item: { ...krUnresolved().items[0]!, state: "ignored" },
    });
    previewProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-PREVIEW") });
    renewProviderEvidenceMock.mockResolvedValueOnce({ operation: operation("OP-RENEW") });
    bulkUpdateProviderUnresolvedStateMock.mockResolvedValueOnce({ operation: operation("OP-BULK"), updatedCount: 1 });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="mappings"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={krMappingData()}
        />,
      );
    });

    expect(container.textContent).toContain("KR mapping repair");
    expect(container.textContent).toContain("Backfill after mapping is a separate explicit action");
    expect(container.textContent).toContain("005930");

    const search = container.querySelector("[data-testid='provider-console-unresolved-search']") as HTMLInputElement;
    const state = container.querySelector("[data-testid='provider-console-unresolved-state']") as HTMLSelectElement;
    await act(async () => {
      search.value = "005930";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      state.value = "ignored";
      state.dispatchEvent(new Event("change", { bubbles: true }));
      container.querySelector("[data-testid='provider-console-unresolved-apply']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/admin/market-data/KR/mappings"));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("unresolvedState=ignored"));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-unresolved-ignore-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(updateProviderUnresolvedStateMock).toHaveBeenCalledWith({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      state: "ignored",
    });

    await act(async () => {
      container.querySelector("[data-testid='provider-console-select-row-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Repair selected")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(previewProviderRepairMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      resolverMode: "quote_first",
    }));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-bulk-renew']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(renewProviderEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      resolverMode: "quote_first",
    }));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-select-all-matching']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("MARK 1 MATCHING UNSUPPORTED");
    await act(async () => {
      container.querySelector("[data-testid='provider-console-bulk-unsupported']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bulkUpdateProviderUnresolvedStateMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      state: "unsupported",
      typedConfirmation: "MARK 1 MATCHING UNSUPPORTED",
      scope: expect.objectContaining({ type: "filter", state: "active" }),
    }));
    promptSpy.mockRestore();
  });

  it("preserves KR mapping links and mapping actions under market-data mappings", async () => {
    reverifyProviderMappingMock.mockResolvedValueOnce({ operation: operation("OP-REVERIFY") });
    rerunProviderMappingMock.mockResolvedValueOnce({ operation: operation("OP-RERUN") });
    revertProviderMappingMock.mockResolvedValueOnce({ operation: operation("OP-REVERT") });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="mappings"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={krMappingData()}
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='provider-console-mapping-unresolved-link-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining("unresolvedState=all"));
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining("unresolvedSearch=005930"));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-mapping-reverify-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(reverifyProviderMappingMock).toHaveBeenCalledWith(expect.objectContaining({ providerId: "yahoo-finance-kr" }));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-mapping-rerun-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(rerunProviderMappingMock).toHaveBeenCalledWith(expect.objectContaining({ providerId: "yahoo-finance-kr" }));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-mapping-revert-open-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirmation = container.querySelector("[data-testid='provider-console-mapping-revert-confirmation-005930']") as HTMLInputElement;
    updateInputValue(confirmation, "REVERT 005930");
    await act(async () => undefined);
    await act(async () => {
      container.querySelector("[data-testid='provider-console-mapping-revert-execute-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(revertProviderMappingMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      typedConfirmation: "REVERT 005930",
    }));
  });

  it("reruns resolved KR unresolved rows through the provider mapping API", async () => {
    rerunProviderResolvedUnresolvedItemMock.mockResolvedValueOnce({ operation: operation("OP-RERUN-ROW") });
    const data = krMappingData();
    data.query.unresolvedState = "resolved";
    data.unresolved.items = data.unresolved.items.map((item) => ({
      ...item,
      state: "resolved" as const,
      resolvedAt: "2026-01-02T00:00:00.000Z",
      resolvedByOperationId: "OP-PREVIEW",
    }));

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="mappings"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={data}
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='provider-console-unresolved-rerun-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(rerunProviderResolvedUnresolvedItemMock).toHaveBeenCalledWith({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolverMode: "quote_first",
    });
  });

  it("repairs an active KR unresolved row without requiring manual selection first", async () => {
    previewProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-PREVIEW-SINGLE") });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="mappings"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={krMappingData()}
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='provider-console-unresolved-repair-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(previewProviderRepairMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      scope: {
        type: "selected_items",
        items: [{
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          sourceSymbol: "005930",
        }],
      },
    }));
  });

  it("executes KR repair from the frozen preview scope after visible selection resets", async () => {
    previewProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-PREVIEW") });
    executeProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-EXECUTED") });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="mappings"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={krMappingData()}
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='provider-console-select-row-005930']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Repair selected")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Clear selection")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("[data-testid='provider-console-confirm-checkbox']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const executeButton = container.querySelector("[data-testid='provider-console-execute-button']") as HTMLButtonElement;
    expect(executeButton.disabled).toBe(false);
    await act(async () => {
      executeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeProviderRepairMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      operationId: "OP-PREVIEW",
      previewToken: "preview-token",
      acknowledged: true,
    }));
  });

  it("preserves KR operation inspector execution and hides generic retry controls", async () => {
    const data = krOperationsData();
    const retryable = marketOperation("OP-FAILED", {
      phase: "failed" as const,
      execute: { ...marketOperation("OP-FAILED").execute, canExecute: false, executeMode: "none", previewToken: null },
    });
    const running = marketOperation("OP-RUNNING", {
      phase: "running" as const,
      canPause: true,
      canResume: false,
      canCancel: true,
      execute: { ...marketOperation("OP-RUNNING").execute, canExecute: false, executeMode: "none", previewToken: null },
    });
    const backfillBase = marketOperation("OP-BACKFILL");
    const backfillPreview = marketOperation("OP-BACKFILL", {
      operationType: "backfill_catalog_rows",
      execute: {
        ...backfillBase.execute,
        endpoint: "market_backfill_execute",
        executeMode: "preview",
        confirmationLevel: "checkbox",
        previewToken: "backfill-token",
      },
      summary: {
        ...backfillBase.summary,
        kind: "backfill_catalog_rows",
        previewParts: [{ kind: "scope", value: "1 KR instrument" }],
      },
      details: {
        kind: "backfill_catalog_rows",
        operationType: "backfill_catalog_rows",
        fields: {
          scope: "selected_catalog_rows",
        },
      },
    });
    data.operations.items = [data.operations.items[0]!, retryable, running, backfillPreview];
    data.operations.total = 4;
    executeProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-EXECUTED") });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="operations"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={data.operations}
          krMappings={null}
        />,
      );
    });

    expect(container.querySelector("[data-testid='provider-console-operations']")).not.toBeNull();
    expect(container.textContent).not.toContain("Outcomes");
    const krOperationTypeFilter = Array.from(
      container.querySelectorAll("[data-testid='provider-console-operations'] select"),
    )[1] as HTMLSelectElement | undefined;
    expect(Array.from(krOperationTypeFilter?.options ?? []).some((option) => option.value === "renew_evidence")).toBe(true);

    act(() => {
      container.querySelector("[data-testid='provider-console-operation-select-OP-PREVIEW']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockPush).toHaveBeenCalledWith("/admin/market-data/KR/operations?page=1&limit=25&operationId=OP-PREVIEW");
    expect(document.body.textContent).not.toContain("repair_mapping");
	    expect(document.body.querySelector("[data-testid='ui-drawer']")).not.toBeNull();
	    expect(document.body.textContent).toContain("Outcomes");
	    const logsLimit = document.body.querySelector("[data-testid='market-data-operation-logs-limit']") as HTMLSelectElement | null;
	    const outcomesLimit = document.body.querySelector("[data-testid='market-data-operation-outcomes-limit']") as HTMLSelectElement | null;
	    expect(logsLimit?.value).toBe("10");
	    expect(outcomesLimit?.value).toBe("25");
	    act(() => {
	      logsLimit!.value = "25";
	      logsLimit!.dispatchEvent(new Event("change", { bubbles: true }));
	    });
	    expect(mockPush).toHaveBeenCalledWith("/admin/market-data/KR/operations?page=1&limit=25&operationId=OP-PREVIEW&operationLogsLimit=25");
	    act(() => {
	      outcomesLimit!.value = "50";
	      outcomesLimit!.dispatchEvent(new Event("change", { bubbles: true }));
	    });
	    expect(mockPush).toHaveBeenCalledWith("/admin/market-data/KR/operations?page=1&limit=25&operationId=OP-PREVIEW&operationOutcomesLimit=50");

	    const selectedOperationParams = new URLSearchParams("operationId=OP-PREVIEW");
    mockSearchParams.mockReturnValue(selectedOperationParams);
    window.history.pushState({}, "", `/admin/market-data/KR/operations?${selectedOperationParams.toString()}`);
    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="operations"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={data.operations}
          krMappings={null}
        />,
      );
    });

    expect(document.body.textContent).toContain("Outcomes");
    expect(document.body.textContent).toContain("Reverify Mapping");

    act(() => {
      document.body.querySelector("[data-testid='provider-console-operation-confirm-checkbox']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body.querySelector("[data-testid='provider-console-operation-execute-button']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeProviderRepairMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      operationId: "OP-PREVIEW",
      previewToken: "preview-token",
      acknowledged: true,
    }));
    await act(async () => undefined);

    act(() => {
      container.querySelector("[data-testid='provider-console-operation-select-OP-FAILED']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith("/admin/market-data/KR/operations?page=1&limit=25&operationId=OP-FAILED");
    await act(async () => undefined);
    expect(document.body.querySelector("[data-testid='provider-console-operation-retry-OP-FAILED']")).toBeNull();

    mutateProviderOperationMock.mockResolvedValueOnce({ operation: operation("OP-RUNNING") });
    act(() => {
      container.querySelector("[data-testid='provider-console-operation-select-OP-RUNNING']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const pauseButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "Pause") as HTMLButtonElement | undefined;
    expect(pauseButton?.disabled).toBe(false);
    await act(async () => {
      pauseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mutateProviderOperationMock).toHaveBeenCalledWith({
      providerId: "yahoo-finance-kr",
      operationId: "OP-RUNNING",
      action: "pause",
    });

    executeMarketBackfillMock.mockResolvedValueOnce({
      operationId: "OP-BACKFILL",
      marketCode: "KR",
      providerId: "yahoo-finance-kr",
      scope: "selected_catalog_rows",
      status: "completed",
      matchCount: 1,
      dateRange: auBackfillDateRange,
      enqueuedJobCount: 0,
      skippedExistingJobCount: 0,
      batchId: null,
    });
    act(() => {
      container.querySelector("[data-testid='provider-console-operation-select-OP-BACKFILL']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body.querySelector("[data-testid='provider-console-operation-confirm-checkbox']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      document.body.querySelector("[data-testid='provider-console-operation-execute-button']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeMarketBackfillMock).toHaveBeenCalledWith("KR", {
      operationId: "OP-BACKFILL",
      previewToken: "backfill-token",
      acknowledged: true,
      typedConfirmation: "",
    });
  });

  it("shows provider filters for multi-provider market operation streams", async () => {
    const operations = auOperations();
    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="operations"
          overview={{ ...overview(), tabs: ["overview", "operations", "activity"], providers: operations.providers }}
          actions={actions()}
          instruments={null}
          operations={operations}
          providerFilterId="yahoo-finance-au"
          krMappings={null}
        />,
      );
    });

    const filter = container.querySelector("[data-testid='market-data-operations-provider-filter']");
	    expect(filter?.textContent ?? "").toContain("All providers");
	    expect(filter?.textContent ?? "").toContain("Yahoo Finance AU");
	    expect(Array.from(container.querySelectorAll("select")).some((select) =>
	      Array.from(select.options).some((option) => option.value === "purge_market_data"),
	    )).toBe(true);
	    const yahooLink = [...container.querySelectorAll("a")]
      .find((link) => link.textContent === "Yahoo Finance AU");
    expect(yahooLink?.getAttribute("href")).toBe("/admin/market-data/AU/operations?providerId=yahoo-finance-au");

  });

  it("resets operation execution acknowledgement when selecting another history row", async () => {
    const operations = auOperations();
    const firstPreview = marketOperation("OP-FIRST", {
      providerId: "yahoo-finance-au",
      market: "AU",
      marketCode: "AU",
      operationType: "backfill_catalog_rows",
      phase: "preview",
      execute: {
        ...marketOperation("OP-FIRST").execute,
        endpoint: "market_backfill_execute",
        canExecute: true,
        executeMode: "preview",
        confirmationLevel: "checkbox",
        previewToken: "first-token",
      },
    });
    const secondPreview = marketOperation("OP-SECOND", {
      providerId: "yahoo-finance-au",
      market: "AU",
      marketCode: "AU",
      operationType: "purge_market_data",
      phase: "preview",
      execute: {
        ...marketOperation("OP-SECOND").execute,
        endpoint: "market_purge_execute",
        canExecute: true,
        executeMode: "preview",
        confirmationLevel: "checkbox",
        previewToken: "second-token",
      },
    });
    operations.items = [firstPreview, secondPreview];
    operations.total = 2;

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="operations"
          overview={{ ...overview(), tabs: ["overview", "operations", "activity"], providers: operations.providers }}
          actions={actions()}
          instruments={null}
          operations={operations}
          krMappings={null}
        />,
      );
    });

    act(() => {
      container.querySelector("[data-testid='market-data-operation-row-OP-FIRST']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const firstConfirm = document.body.querySelector("[data-testid='provider-console-operation-confirm-checkbox']") as HTMLInputElement;
    act(() => {
      firstConfirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((document.body.querySelector("[data-testid='provider-console-operation-execute-button']") as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      container.querySelector("[data-testid='market-data-operation-row-OP-SECOND']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const secondConfirm = document.body.querySelector("[data-testid='provider-console-operation-confirm-checkbox']") as HTMLInputElement;
    const secondExecute = document.body.querySelector("[data-testid='provider-console-operation-execute-button']") as HTMLButtonElement;
    expect(secondConfirm.checked).toBe(false);
    expect(secondExecute.disabled).toBe(true);
  });

  it("submits the trimmed typed confirmation from operation history execute", async () => {
    const operations = auOperations();
    const typedPurge = marketOperation("OP-TYPED-PURGE", {
      providerId: "yahoo-finance-au",
      market: "AU",
      marketCode: "AU",
      operationType: "purge_market_data",
      phase: "preview",
      execute: {
        ...marketOperation("OP-TYPED-PURGE").execute,
        endpoint: "market_purge_execute",
        canExecute: true,
        executeMode: "preview",
        confirmationLevel: "typed",
        confirmationText: "PURGE AU",
        previewToken: "purge-history-token",
      },
    });
    operations.items = [typedPurge];
    operations.total = 1;
    executeMarketPurgeMock.mockResolvedValueOnce({
      operationId: "OP-TYPED-PURGE-EXECUTED",
      marketCode: "AU",
      providerId: "yahoo-finance-au",
      status: "completed",
      categories: ["price_bars"],
      affectedInstrumentCount: 1,
      deletedRows: 5,
      linkedBackfillOperationId: null,
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="operations"
          overview={{ ...overview(), tabs: ["overview", "operations", "activity"], providers: operations.providers }}
          actions={actions()}
          instruments={null}
          operations={operations}
          krMappings={null}
        />,
      );
    });

    act(() => {
      container.querySelector("[data-testid='market-data-operation-row-OP-TYPED-PURGE']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      document.body.querySelector("[data-testid='provider-console-operation-confirm-checkbox']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    updateInputValue(
      document.body.querySelector("[data-testid='provider-console-operation-typed-confirmation']") as HTMLInputElement,
      " PURGE AU ",
    );
    const executeButton = document.body.querySelector("[data-testid='provider-console-operation-execute-button']") as HTMLButtonElement;
    expect(executeButton.disabled).toBe(false);
    await act(async () => {
      executeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(executeMarketPurgeMock).toHaveBeenCalledWith("AU", {
      operationId: "OP-TYPED-PURGE",
      previewToken: "purge-history-token",
      typedConfirmation: "PURGE AU",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders delisting override controls separately from support controls", async () => {
    updateMarketInstrumentDelistingOverrideMock.mockResolvedValueOnce({
      instrument: {
        ...instruments("BHP", "BHP Group").items[0]!,
        status: "excluded",
        delistingDetectionExcluded: true,
      },
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="instruments"
          overview={overview()}
          actions={actions()}
          instruments={instruments("BHP", "BHP Group")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "all",
            supportState: "all",
            search: "",
            instrumentType: "all",
            backfillStatus: "all",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
        />,
      );
    });

    const instrumentsTable = container.querySelector("[data-testid='market-data-instruments'] table");
    expect(instrumentsTable?.className).toContain("w-max");
    expect(instrumentsTable?.className).toContain("min-w-[72rem]");
    act(() => {
      container.querySelector("[data-testid='market-data-instrument-row-BHP']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Support controls");
    expect(document.body.textContent).toContain("Delisting override");
    const excludeButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "Exclude detection");
    expect(excludeButton).toBeTruthy();

    act(() => {
      excludeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateMarketInstrumentDelistingOverrideMock).toHaveBeenCalledWith({
      ticker: "BHP",
      marketCode: "AU",
      action: "exclude_from_delisting_detection",
    });
  });

  it("refreshes visible rows when server instrument props change after filtering", async () => {
    const query = {
      page: 1,
      limit: 50,
      status: "all",
      supportState: "all",
      search: "",
      instrumentType: "all",
      backfillStatus: "all",
      sort: "ticker_asc",
    };

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="instruments"
          overview={overview()}
          actions={actions()}
          instruments={instruments("OLD", "Old row")}
          instrumentQuery={query}
          operations={null}
          krMappings={null}
        />,
      );
    });
    expect(container.textContent).toContain("OLD");

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="instruments"
          overview={overview()}
          actions={actions()}
          instruments={instruments("NEW", "Filtered row")}
          instrumentQuery={{ ...query, search: "NEW" }}
          operations={null}
          krMappings={null}
        />,
      );
    });

    expect(container.textContent).toContain("NEW");
    expect(container.textContent).not.toContain("OLD");
  });

  it("renders the activity panel with summary, filters, pagination, and details drawer", async () => {
    const activity = activityResponse();

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="activity"
          overview={{ ...overview(), tabs: ["overview", "activity"] as never }}
          actions={actions()}
          instruments={null}
          operations={null}
          activity={activity}
          calendar={null}
          krMappings={null}
        />,
      );
    });

    expect(container.textContent).toContain("Activity");
    expect(container.textContent).toContain("Yahoo chart");
    expect(container.textContent).toContain("Detailed intraday events retained 7 days.");
    const sourceKindFilter = container.querySelector("[data-testid='activity-source-kind-filter']") as HTMLSelectElement | null;
    expect(Array.from(sourceKindFilter?.options ?? []).map((option) => option.value)).toEqual(expect.arrayContaining([
      "yahoo_chart",
      "official_calendar",
    ]));
    expect(sourceKindFilter?.value).toBe("yahoo_chart");
    const sourceIdFilter = container.querySelector("[data-testid='activity-source-id-filter']") as HTMLSelectElement | null;
    expect(sourceIdFilter?.value).toBe("yahoo-finance-chart");
    const categoryFilter = container.querySelector("[data-testid='activity-category-filter']") as HTMLSelectElement | null;
    expect(categoryFilter?.value).toBe("intraday_price");
    expect(sourceKindFilter?.className).toContain("min-w-0");
    const activityTable = container.querySelector("[data-testid='activity-row-act-1']")?.closest("table");
    expect(activityTable?.className).toContain("w-max");
    expect(activityTable?.className).toContain("min-w-[64rem]");

    const yahooSummary = container.querySelector("[data-testid='activity-yahoo-summary']") as HTMLButtonElement | null;
    expect(yahooSummary).not.toBeNull();
    await act(async () => {
      yahooSummary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/admin/market-data/AU/activity?"));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("sourceId=yahoo-finance-chart"));

    const row = container.querySelector("[data-testid='activity-row-act-1']") as HTMLTableRowElement | null;
    expect(row?.getAttribute("tabindex")).toBe("0");
    expect(row?.getAttribute("role")).toBe("button");
    act(() => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(document.body.textContent).toContain("queued by dashboard enrichment read");
  });

  it("keeps operation drawers closed until a row is tapped", async () => {
    const operations = auOperations();
    const data = krOperationsData();

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="operations"
          overview={{ ...overview(), tabs: ["overview", "operations"], providers: operations.providers }}
          actions={actions()}
          instruments={null}
          operations={operations}
          krMappings={null}
        />,
      );
    });

    expect(document.body.querySelector("[data-testid='ui-drawer']")).toBeNull();
    act(() => {
      container.querySelector("[data-testid='market-data-operation-row-OP-AU']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Open filtered activity");

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="operations"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={data.operations}
          krMappings={null}
        />,
      );
    });

    expect(document.body.textContent ?? "").not.toContain("Operation item outcomes");
    act(() => {
      container.querySelector("[data-testid='provider-console-operation-select-OP-PREVIEW']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith("/admin/market-data/KR/operations?page=1&limit=25&operationId=OP-PREVIEW");
    expect(document.body.textContent).not.toContain("Operation item outcomes");
    expect(document.body.querySelector("[data-testid='ui-drawer']")).not.toBeNull();
    expect(document.body.textContent).toContain("Outcomes");

    const selectedOperationParams = new URLSearchParams("operationId=OP-PREVIEW");
    mockSearchParams.mockReturnValue(selectedOperationParams);
    window.history.pushState({}, "", `/admin/market-data/KR/operations?${selectedOperationParams.toString()}`);
    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="operations"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={data.operations}
          krMappings={null}
        />,
      );
    });
    expect(document.body.querySelector("[data-testid='ui-drawer']")).not.toBeNull();
    expect(document.body.textContent).toContain("Outcomes");

    act(() => {
      document.body.querySelector("[data-testid='ui-drawer-close']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => undefined);
    expect(document.body.querySelector("[data-testid='ui-drawer']")).toBeNull();
  });

  it("persists admin market data column settings under adminMarketDataTableSettings", async () => {
    getJsonMock.mockResolvedValueOnce({
      preferences: {
        adminMarketDataTableSettings: {
          version: 1,
          contexts: {
            "admin.marketData.AU.instruments": {
              columnOrder: ["ticker", "backfill", "status", "support", "providers", "lastSeen"],
              mobileSummaryCount: 2,
              columnWidths: { ticker: 260 },
            },
          },
        },
      },
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="instruments"
          overview={overview()}
          actions={actions()}
          instruments={instruments("BHP", "BHP Group")}
          instrumentQuery={{
            page: 1,
            limit: 50,
            status: "all",
            supportState: "all",
            search: "",
            instrumentType: "all",
            backfillStatus: "all",
            sort: "ticker_asc",
          }}
          operations={null}
          krMappings={null}
        />,
      );
    });

    const headers = [...container.querySelectorAll('[data-testid^="admin-market-data-column-drag-"]')];
    expect(headers[0]?.getAttribute("data-testid")).toBe("admin-market-data-column-drag-ticker");

    act(() => {
      container.querySelector("[data-testid='admin-market-data-column-settings']")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await act(async () => undefined);

    const moveRight = document.body.querySelector('[data-testid="admin-market-data-column-move-right-backfill"]');
    expect(moveRight).not.toBeNull();
    act(() => {
      moveRight?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(patchJsonMock).toHaveBeenCalledWith("/user-preferences", expect.objectContaining({
      adminMarketDataTableSettings: expect.objectContaining({
        contexts: expect.objectContaining({
          "admin.marketData.AU.instruments": expect.objectContaining({
            columnOrder: ["ticker", "status", "backfill", "support", "providers", "lastSeen"],
          }),
        }),
      }),
    }), { contextScope: "session" });
  });

  it("keeps the identity column visible in mobile cards", async () => {
    mockIsSmallScreen.mockReturnValue(true);
    getJsonMock.mockResolvedValueOnce({
      preferences: {
        adminMarketDataTableSettings: {
          version: 1,
          contexts: {
            "admin.marketData.AU.activity": {
              hiddenColumns: ["facts", "source"],
              mobileSummaryCount: 1,
            },
          },
        },
      },
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="activity"
          overview={{ ...overview(), tabs: ["overview", "activity"] as never }}
          actions={actions()}
          instruments={null}
          operations={null}
          activity={activityResponse()}
          calendar={null}
          krMappings={null}
        />,
      );
    });

    const mobileRow = container.querySelector("[data-testid='activity-row-act-1']");
    expect(mobileRow?.textContent).toContain("BHP.AX");
    expect(mobileRow?.textContent).toContain("Warning");
  });

  it("renders the calendar panel shell with source, preview, and history areas", async () => {
    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="calendar"
          overview={{ ...overview(), tabs: ["overview", "calendar"] as never }}
          actions={actions()}
          instruments={null}
          operations={null}
          activity={null}
          calendar={calendarResponse()}
          krMappings={null}
        />,
      );
    });

    expect(container.textContent).toContain("Calendar coverage");
    expect(container.textContent).toContain("Active calendar");
    expect(container.textContent).toContain("Weekdays are open and weekends are closed");
    expect(container.textContent).toContain("New Year's Day");
    expect(container.textContent).toContain("Special Saturday session");
    expect(container.textContent).toContain("Paste normalized JSON");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Import operation: import-op-1");
    expect(container.querySelector("[data-testid='calendar-source-editor']")).not.toBeNull();
    expect(container.textContent).toContain("Suggested source URL");
    expect(container.querySelector("[data-testid='calendar-preview-button']")).not.toBeNull();
  });

  it("filters active calendar exceptions by weekday closures and weekend openings", async () => {
    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="calendar"
          overview={{ ...overview(), tabs: ["overview", "calendar"] as never }}
          actions={actions()}
          instruments={null}
          operations={null}
          activity={null}
          calendar={calendarResponse()}
          krMappings={null}
        />,
      );
    });

    const filter = container.querySelector("[data-testid='calendar-active-filter']") as HTMLSelectElement | null;
    expect(filter).not.toBeNull();
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-01']")).not.toBeNull();
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-03']")).not.toBeNull();

    await act(async () => {
      filter!.value = "closed";
      filter!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-01']")).not.toBeNull();
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-03']")).toBeNull();

    await act(async () => {
      filter!.value = "open";
      filter!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-01']")).toBeNull();
    expect(container.querySelector("[data-testid='calendar-exception-2026-01-03']")).not.toBeNull();
  });

  it("forwards replacement confirmation when previewing and confirming calendar imports", async () => {
    previewMarketCalendarImportMock.mockResolvedValueOnce({
      marketCode: "AU",
      preview: {
        added: 1,
        changed: 0,
        removed: 0,
        previewToken: "preview-token",
        warnings: [],
        confirmable: true,
        replaceConfirmedRequired: true,
        rows: [],
      },
    });
    confirmMarketCalendarImportMock.mockResolvedValueOnce({
      marketCode: "AU",
      status: "confirmed",
      versionId: "calendar-version-1",
    });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="AU"
          tab="calendar"
          overview={{ ...overview(), tabs: ["overview", "calendar"] as never }}
          actions={actions()}
          instruments={null}
          operations={null}
          activity={null}
          calendar={calendarResponse()}
          krMappings={null}
        />,
      );
    });

    const jsonInput = container.querySelector("[data-testid='calendar-json-input']") as HTMLTextAreaElement | null;
    expect(jsonInput).not.toBeNull();
    expect(() => JSON.parse(jsonInput?.value ?? "")).not.toThrow();
    const parsedExample = JSON.parse(jsonInput?.value ?? "{}") as {
      coverage?: Record<string, unknown>;
      exceptions?: Array<Record<string, unknown>>;
    };
    expect(parsedExample.coverage?.assertion).toBeUndefined();
    expect(parsedExample.exceptions?.[0]?.overrideReason).toBe("Official holiday closure.");

    updateTextareaValue(jsonInput as HTMLTextAreaElement, JSON.stringify({
      calendarYear: 2026,
      sourceType: "official_source",
      label: "ASX official calendar",
      retrievedAt: "2026-06-19T00:00:00.000Z",
      coverage: {
        scope: "full_year",
        evidence: "Official source checked.",
      },
      exceptions: [{
        date: "2026-01-01",
        status: "closed",
        name: "New Year's Day",
        evidence: "Official holiday notice",
        overrideReason: "Official holiday closure.",
      }],
      replaceConfirmed: true,
      replacementReason: "Replacing active official version after AI review.",
    }));

    const previewButton = container.querySelector("[data-testid='calendar-preview-button']") as HTMLButtonElement | null;
    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(previewMarketCalendarImportMock).toHaveBeenCalledWith("AU", expect.objectContaining({
      replaceConfirmed: true,
      replacementReason: "Replacing active official version after AI review.",
    }));

    const confirmButton = container.querySelector("[data-testid='calendar-confirm-button']") as HTMLButtonElement | null;
    expect(confirmButton?.disabled).toBe(false);
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(confirmMarketCalendarImportMock).toHaveBeenCalledWith("AU", {
      previewToken: "preview-token",
      replaceConfirmed: true,
      replacementReason: "Replacing active official version after AI review.",
    });
    expect(mockRefresh).toHaveBeenCalled();
  });
});
