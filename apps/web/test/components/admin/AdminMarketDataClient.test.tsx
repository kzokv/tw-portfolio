import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("../../../lib/adminMarketDataService", () => ({
  confirmMarketCalendarImport: vi.fn(),
  executeMarketBackfill: vi.fn(),
  executeMarketSnapshotRepair: vi.fn(),
  executeProviderRepair: vi.fn(),
  executeMarketPurge: vi.fn(),
  fetchMarketValuationRepairStatus: vi.fn(),
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
  mutateProviderOperation,
  previewMarketBackfill,
  previewMarketPurge,
  previewProviderRepair,
  renewProviderEvidence,
  rerunProviderResolvedUnresolvedItem,
  reverifyProviderMapping,
  revertProviderMapping,
  rerunProviderMapping,
  updateMarketInstrumentDelistingOverride,
  updateProviderUnresolvedState,
} from "../../../lib/adminMarketDataService";

const updateMarketInstrumentDelistingOverrideMock = vi.mocked(updateMarketInstrumentDelistingOverride);
const bulkUpdateProviderUnresolvedStateMock = vi.mocked(bulkUpdateProviderUnresolvedState);
const updateProviderUnresolvedStateMock = vi.mocked(updateProviderUnresolvedState);
const executeProviderRepairMock = vi.mocked(executeProviderRepair);
const executeMarketBackfillMock = vi.mocked(executeMarketBackfill);
const executeMarketSnapshotRepairMock = vi.mocked(executeMarketSnapshotRepair);
const executeMarketPurgeMock = vi.mocked(executeMarketPurge);
const fetchMarketValuationRepairStatusMock = vi.mocked(fetchMarketValuationRepairStatus);
const mutateProviderOperationMock = vi.mocked(mutateProviderOperation);
const previewMarketBackfillMock = vi.mocked(previewMarketBackfill);
const previewMarketPurgeMock = vi.mocked(previewMarketPurge);
const previewProviderRepairMock = vi.mocked(previewProviderRepair);
const renewProviderEvidenceMock = vi.mocked(renewProviderEvidence);
const rerunProviderResolvedUnresolvedItemMock = vi.mocked(rerunProviderResolvedUnresolvedItem);
const reverifyProviderMappingMock = vi.mocked(reverifyProviderMapping);
const rerunProviderMappingMock = vi.mocked(rerunProviderMapping);
const revertProviderMappingMock = vi.mocked(revertProviderMapping);

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
  const selected = operation("OP-PREVIEW");
  const operations: ProviderFixerDashboardOperationsResponse = {
    stagedOperation: selected,
    selectedOperation: selected,
    operations: [selected],
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
    selectedOperationId: selected.id,
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
    items: [{ ...operation("OP-AU"), providerId: "yahoo-finance-au", market: "AU", phase: "completed" }],
    total: 1,
    page: 1,
    limit: 25,
  };
}

function activityResponse(): AdminMarketDataActivityResponse {
  return {
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
    query: { page: 1, limit: 25, search: "", source: "", category: "", result: "warning,error", timeRange: "24h" },
  };
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
      sourceType: "official_parser",
      url: "https://www.asx.com.au/markets/trade-our-cash-market/directory",
      host: "www.asx.com.au",
      allowedHosts: ["www.asx.com.au"],
      parserType: "au-official",
      isDefault: true,
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

describe("AdminMarketDataWorkspaceClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockRefresh.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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

  it("preserves KR operation inspector execution, outcomes, and retry controls", async () => {
    const data = krOperationsData();
    const retryable = {
      ...operation("OP-FAILED"),
      phase: "failed" as const,
      canExecute: false,
      canRetry: true,
    };
    data.operations.operations = [data.operations.operations[0]!, retryable];
    executeProviderRepairMock.mockResolvedValueOnce({ operation: operation("OP-EXECUTED") });
    mutateProviderOperationMock.mockResolvedValueOnce({ operation: operation("OP-RETRY") });

    await act(async () => {
      root.render(
        <AdminMarketDataWorkspaceClient
          marketCode="KR"
          tab="operations"
          overview={krOverview()}
          actions={krActions()}
          instruments={null}
          operations={null}
          krMappings={null}
          krOperations={data}
        />,
      );
    });

    expect(container.querySelector("[data-testid='market-data-kr-operations']")).not.toBeNull();
    expect(container.textContent).toContain("Operation item outcomes");
    expect(container.textContent).toContain("repair_mapping");

    await act(async () => {
      container.querySelector("[data-testid='provider-console-operation-confirm-checkbox']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("[data-testid='provider-console-operation-execute-button']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(executeProviderRepairMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      operationId: "OP-PREVIEW",
      previewToken: "preview-token",
      acknowledged: true,
    }));

    await act(async () => {
      container.querySelector("[data-testid='provider-console-operation-retry-OP-FAILED']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mutateProviderOperationMock).toHaveBeenCalledWith({
      providerId: "yahoo-finance-kr",
      operationId: "OP-FAILED",
      action: "retry",
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
    const yahooLink = [...container.querySelectorAll("a")]
      .find((link) => link.textContent === "Yahoo Finance AU");
    expect(yahooLink?.getAttribute("href")).toBe("/admin/market-data/AU/operations?providerId=yahoo-finance-au");

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

    expect(container.textContent).toContain("Support controls");
    expect(container.textContent).toContain("Delisting override");
    const excludeButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Exclude detection");
    expect(excludeButton).toBeTruthy();

    await act(async () => {
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

    const yahooSummary = container.querySelector("[data-testid='activity-yahoo-summary']") as HTMLButtonElement | null;
    expect(yahooSummary).not.toBeNull();
    await act(async () => {
      yahooSummary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/admin/market-data/AU/activity?"));

    const row = container.querySelector("[data-testid='activity-row-act-1']") as HTMLTableRowElement | null;
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("queued by dashboard enrichment read");
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
    expect(container.textContent).toContain("Paste normalized JSON");
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("Import operation: import-op-1");
    expect(container.querySelector("[data-testid='calendar-source-editor']")).not.toBeNull();
    expect(container.textContent).toContain("Allowed hosts");
    expect(container.querySelector("[data-testid='calendar-preview-button']")).not.toBeNull();
  });
});
