import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataOverviewResponse,
  ProviderFixerDashboardOperationDto,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemsResponse,
} from "@vakwen/shared-types";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("../../../lib/adminMarketDataService", () => ({
  executeMarketBackfill: vi.fn(),
  executeProviderRepair: vi.fn(),
  executeMarketPurge: vi.fn(),
  bulkUpdateProviderUnresolvedState: vi.fn(),
  previewProviderRepair: vi.fn(),
  previewMarketBackfill: vi.fn(),
  previewMarketPurge: vi.fn(),
  renewProviderEvidence: vi.fn(),
  reverifyProviderMapping: vi.fn(),
  revertProviderMapping: vi.fn(),
  rerunProviderMapping: vi.fn(),
  updateMarketInstrumentSupportState: vi.fn(),
  updateProviderUnresolvedState: vi.fn(),
  updateMarketInstrumentDelistingOverride: vi.fn(),
}));

import { AdminMarketDataWorkspaceClient } from "../../../components/admin/AdminMarketDataClient";
import {
  bulkUpdateProviderUnresolvedState,
  previewProviderRepair,
  renewProviderEvidence,
  reverifyProviderMapping,
  revertProviderMapping,
  rerunProviderMapping,
  updateMarketInstrumentDelistingOverride,
  updateProviderUnresolvedState,
} from "../../../lib/adminMarketDataService";

const updateMarketInstrumentDelistingOverrideMock = vi.mocked(updateMarketInstrumentDelistingOverride);
const bulkUpdateProviderUnresolvedStateMock = vi.mocked(bulkUpdateProviderUnresolvedState);
const updateProviderUnresolvedStateMock = vi.mocked(updateProviderUnresolvedState);
const previewProviderRepairMock = vi.mocked(previewProviderRepair);
const renewProviderEvidenceMock = vi.mocked(renewProviderEvidence);
const reverifyProviderMappingMock = vi.mocked(reverifyProviderMapping);
const rerunProviderMappingMock = vi.mocked(rerunProviderMapping);
const revertProviderMappingMock = vi.mocked(revertProviderMapping);

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

function krOverview(): AdminMarketDataOverviewResponse {
  return {
    marketCode: "KR",
    label: "Korea",
    tabs: ["overview", "mappings"],
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
      tokenExpiresAt: "2026-01-01T00:00:00.000Z",
      snapshotHash: "snapshot",
      matchCount: 1,
      sampleCount: 1,
      confirmationMode: "standard",
      confirmationText: null,
      acknowledgementLabel: "Acknowledge",
      scopeSummary: "1 selected unresolved row",
      search: null,
      state: "active",
      frozenScope: null,
      evidenceSample: [],
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
      unresolvedPage: 1,
      unresolvedLimit: 25,
      unresolvedState: "active" as const,
      unresolvedSearch: "",
      unresolvedSort: "last_seen_desc" as const,
      mappingsPage: 1,
      mappingsLimit: 25,
      mappingsSearch: "",
    },
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
          logs={null}
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
    await act(async () => {
      container.querySelector("[data-testid='provider-console-bulk-unsupported']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(bulkUpdateProviderUnresolvedStateMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "yahoo-finance-kr",
      state: "unsupported",
      typedConfirmation: "MARK 1 MATCHING UNSUPPORTED",
      scope: expect.objectContaining({ type: "filter", state: "active" }),
    }));
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
          logs={null}
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

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
          logs={null}
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
          logs={null}
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
          logs={null}
          krMappings={null}
        />,
      );
    });

    expect(container.textContent).toContain("NEW");
    expect(container.textContent).not.toContain("OLD");
  });
});
