import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UnrealizedPnlAnalysisClient } from "../../../components/analysis/UnrealizedPnlAnalysisClient";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { getDictionary } from "../../../lib/i18n";
import { ANALYSIS_DEFAULT_STATE } from "../../../features/analysis/unrealizedPnlRouteState";
import { buildPreviewUnrealizedPnlAnalysis } from "../../../features/analysis/unrealizedPnlPreview";

const replaceMock = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({ value: "" }));
const getJsonMock = vi.hoisted(() => vi.fn(async () => ({ preferences: {} })));
const patchJsonMock = vi.hoisted(() => vi.fn(async () => ({ preferences: {} })));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("../../../lib/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../lib/api", () => ({
  getJson: getJsonMock,
  patchJson: patchJsonMock,
}));

function buildShellData(): AppShellData {
  const dict = getDictionary("en");
  return {
    uiDict: dict,
    locale: "en",
    sessionUserId: "user-1",
    isSharedContext: false,
    currentSharedCapabilities: [],
    sharedContextPermissions: {
      canManageAccounts: true,
      canManageSharing: true,
      canReadAiDrafts: true,
      canWriteTransactions: true,
      canCreateDrafts: true,
      canEditDrafts: true,
      canArchiveDrafts: true,
      canDeleteDrafts: true,
      hasAnyDelegatedWrite: true,
    },
    canUseGlobalQuickActions: false,
    openQuickActions: vi.fn(),
    reportingCurrency: "TWD",
    saveReportingCurrency: vi.fn(async () => undefined),
    isReportingCurrencySaving: false,
    reportingCurrencyError: "",
    transactionSubmission: {} as never,
    mutations: {} as never,
    recomputeAction: {} as never,
    openRecomputeConfirm: vi.fn(),
    transactionAccountOptions: [],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    refreshPortfolioConfig: vi.fn(async () => undefined),
    isPortfolioConfigLoading: false,
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(async () => undefined),
    isGeneratingSnapshots: false,
    contextRefreshSignal: 0,
    routeCachePolicy: null,
  };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("UnrealizedPnlAnalysisClient", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    replaceMock.mockReset();
    getJsonMock.mockReset();
    getJsonMock.mockResolvedValue({ preferences: {} });
    patchJsonMock.mockReset();
    patchJsonMock.mockResolvedValue({ preferences: {} });
    searchParamsState.value = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container.remove();
  });

  it("renders the preview shell and routes ranking selection into deterministic URL state", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("Unrealized P&L Analysis");
    expect(container.textContent).toContain("Preview contract fallback");
    expect(container.textContent).toContain("Ticker ranking");

    const aaplRow = Array.from(container.querySelectorAll("tr")).find((row) => row.textContent?.includes("AAPL US"));
    const checkbox = aaplRow?.querySelector("button[role='checkbox']");
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(replaceMock).toHaveBeenCalled();
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("selectionMode=manual");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("selectedTickers=");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("view=compare");
  });

  it("builds ticker toggles from pending manual selection while data refetches", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selectionMode: "manual" as const,
      selected: ["US:NVDA"],
      lineCount: 5,
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    const rowCheckbox = (label: string): HTMLButtonElement | null => {
      const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes(label));
      return row?.querySelector("button[role='checkbox']") ?? null;
    };

    act(() => {
      rowCheckbox("AAPL US")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      rowCheckbox("2330 TW")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const lastUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    expect(lastUrl).toContain("selectionMode=manual");
    expect(lastUrl).toContain("selectedTickers=TW%3A2330%2CUS%3AAAPL%2CUS%3ANVDA");
  });

  it("hydrates presentation defaults from preferences when the URL does not override them", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlDefaults: {
          granularity: "monthly",
          lineCount: 8,
          holdingsState: "include-sold",
          reportingCurrency: "USD",
          includeProvisional: true,
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(getJsonMock).toHaveBeenCalledWith("/user-preferences", { contextScope: "session" });
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("granularity=monthly");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("comparisonLineCount=8");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("holdingsState=include_sold_out");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("reportingCurrency=USD");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("includeProvisional=true");
    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("keeps explicit URL presentation values ahead of saved defaults", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlDefaults: {
          granularity: "monthly",
          lineCount: 8,
          holdingsState: "include-sold",
          reportingCurrency: "USD",
          includeProvisional: true,
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient
            explicitPreferenceKeys={{
              granularity: true,
              lineCount: true,
              holdingsState: true,
              reportingCurrency: true,
              includeProvisional: true,
            }}
            initialData={initialData}
            initialState={ANALYSIS_DEFAULT_STATE}
          />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("persists presentation defaults when the line-count control changes", async () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    const lineInput = Array.from(container.querySelectorAll("input")).find((input) => input.getAttribute("aria-label") === "Lines") as HTMLInputElement | undefined;
    expect(lineInput).toBeDefined();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(lineInput, "7");
      lineInput!.dispatchEvent(new Event("input", { bubbles: true }));
      lineInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(patchJsonMock).toHaveBeenLastCalledWith(
      "/user-preferences",
      {
        analysisUnrealizedPnlDefaults: {
          granularity: "weekly",
          lineCount: 7,
          holdingsState: "current-only",
          reportingCurrency: "TWD",
          includeProvisional: false,
        },
      },
      { contextScope: "session" },
    );
  });

  it("syncs focus scrub changes into the URL", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    const slider = container.querySelector("[data-testid='analysis-focus-scrub']") as HTMLInputElement | null;
    expect(slider).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "2");
      slider!.dispatchEvent(new Event("input", { bubbles: true }));
      slider!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("focus=2026-04-24");
  });

  it("restores the focus scrub position from deep-link state", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    const slider = container.querySelector("[data-testid='analysis-focus-scrub']") as HTMLInputElement | null;
    expect(slider).not.toBeNull();
    expect(slider?.value).toBe("2");
    expect(container.textContent).toContain("Apr 24, 2026");
  });

  it("does not show stale selected detail values when a focused date is missing for a series", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);
    const sparseData = {
      ...initialData,
      tickerSeries: initialData.tickerSeries.map((series) => {
        if (series.seriesId !== "US:NVDA") return series;
        const lastPoint = series.points.at(-1);
        return {
          ...series,
          points: series.points
            .filter((point) => point.date !== focusedState.focusDate)
            .map((point) => point.date === lastPoint?.date ? { ...point, unrealizedPnl: 987654321 } : point),
        };
      }),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={sparseData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("NVDA US");
    expect(container.textContent).toContain("Pending");
    expect(container.textContent).not.toContain("987,654,321");
  });

  it("formats ranking and detail amounts with the response currency", () => {
    const audState = { ...ANALYSIS_DEFAULT_STATE, reportingCurrency: "AUD" as const };
    const initialData = buildPreviewUnrealizedPnlAnalysis(audState, "AUD");

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={audState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("A$");
    expect(container.textContent).not.toContain("NT$");
  });

  it("keeps stale response values in their original currency while refreshing the selected reporting currency", async () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE, "AUD");

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='analysis-stale-currency-banner']")).not.toBeNull();
    expect(container.textContent).toContain("Refreshing values in TWD");
    expect(container.textContent).toContain("A$");
  });
});
