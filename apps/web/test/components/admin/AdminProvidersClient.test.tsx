import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ProviderActivityItemDto,
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
  ProviderHealthStatusDto,
  ProviderIncidentDto,
  ProviderOperationCapabilityDto,
  ProviderOperationOutcomeDto,
  ProviderOperationOutcomeSummaryDto,
  ProviderResolutionMappingDto,
  ProviderUnresolvedItemDto,
} from "@vakwen/shared-types";

const mockRefresh = vi.fn();
const mockPush = vi.fn();
const mockPostJson = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string | null;

    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
  getApiBaseUrl: () => "http://localhost:4000",
  patchJson: vi.fn(),
  postJson: (...args: unknown[]) => mockPostJson(...args),
}));

import { AdminProvidersClient } from "../../../components/admin/AdminProvidersClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildProvider(overrides: Partial<ProviderHealthStatusDto> = {}): ProviderHealthStatusDto {
  return {
    providerId: "yahoo-finance-kr",
    status: "awaiting",
    lastSuccessfulRun: null,
    lastFailedRun: "2026-06-03T00:00:00Z",
    errorCount24h: 8,
    errorCount7d: 1120,
    rateLimitCount24h: 1,
    lastErrorMessage: "provider symbol unresolved",
    lastManualRerunAt: null,
    rerunCooldownMs: 1800000,
    updatedAt: "2026-06-03T00:00:00Z",
    recentErrors: [],
    ...overrides,
  };
}

function buildGuardrails(): ProviderFixerDashboardGuardrailSettingsDto {
  return {
    dangerousMatchThreshold: 500,
    previewSampleLimit: 120,
    uiPageSize: 10,
    autoPauseFailureThresholdPerMinute: 20,
    previewTokenTtlSeconds: 900,
    healthWarningUnresolvedThreshold: 1000,
    healthCriticalUnresolvedThreshold: 10000,
  };
}

function buildSummary(): ProviderFixerDashboardSummaryDto {
  return {
    criticalUnresolvedCount: 1842,
    affectedProviders: ["finmind-us", "finmind-tw", "yahoo-finance-kr"],
    activeOperationsCount: 3,
    queuedOperationsCount: 2,
    runningOperationsCount: 1,
    guardrailsEnabled: true,
    effectiveRateCapPerMinute: 250,
  };
}

function buildDiagnostics(): ProviderFixerDashboardDiagnosticsDto {
  return {
    resolverMode: "quote_first",
    providerId: "yahoo-finance-kr",
    errorCode: "yahoo_finance_kr_symbol_unresolved",
    recommendation:
      "use market=KR, error_code=yahoo_finance_kr_symbol_unresolved, then start with Query mode (no execute) to capture preview.",
    guardrails: buildGuardrails(),
    rows: [
      {
        providerId: "yahoo-finance-kr",
        market: "KRX",
        unresolvedCount: 1120,
        resolverStatus: "enabled",
        severity: "warning",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
      {
        providerId: "finmind-tw",
        market: "TWSE",
        unresolvedCount: 612,
        resolverStatus: "disabled",
        severity: "warning",
        errorCode: "provider_symbol_unresolved",
      },
    ],
  };
}

function buildOperation(
  overrides: Partial<ProviderFixerDashboardOperationDto> = {},
): ProviderFixerDashboardOperationDto {
  return {
    id: "OP-20260602-1842",
    providerId: "yahoo-finance-kr",
    market: "KRX",
    phase: "preview",
    matchCount: 1842,
    preview: {
      scopeType: "filter",
      scopeLabel: "symbol_unresolved",
      scopeSummary: "1842 active unresolved rows matching the current filter",
      queryBacked: true,
      page: 1,
      totalPages: 184,
      token: "PF-UNSAFE-OK",
      tokenExpiresAt: "2026-06-30T14:15:00.000Z",
      snapshotHash: "2d14f",
      matchCount: 1842,
      sampleCount: 120,
      confirmationMode: "typed",
      confirmationText: "EXECUTE 1842 MATCHING",
      acknowledgementLabel: "I understand this can write provider rows",
      search: null,
      state: "active",
      frozenScope: {
        type: "filter",
        filterFingerprint: JSON.stringify({
          providerId: "yahoo-finance-kr",
          resolverMode: "quote_first",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          state: "active",
          search: null,
          sort: "last_seen_desc",
        }),
        matchCount: 1842,
        selectedItems: [],
        filter: {
          providerId: "yahoo-finance-kr",
          marketCode: "KR",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          state: "active",
          search: null,
        },
      },
      evidenceSample: [
        {
          symbol: "005930",
          providerSymbol: "005930",
          candidateSymbol: "005930.KS",
          exchangeHint: "Twelve Data exchange=KRX",
          verificationStatus: "verified",
          note: "Quote + chart probe both resolved.",
        },
      ],
    },
    canExecute: true,
    canPause: false,
    canResume: false,
    canCancel: false,
    canRetry: false,
    dangerous: true,
    progressPercent: 62,
    autoPauseFailureCount: 12,
    autoPauseFailureThresholdPerMinute: 20,
    effectiveRateCapPerMinute: 250,
    ...overrides,
  };
}

function buildLogs(): ProviderFixerDashboardLogEntryDto[] {
  return [
    {
      id: "pflog-1",
      occurredAt: "2026-06-02T14:42:11.000Z",
      phase: "diagnose",
      operationId: null,
      message:
        "provider=yahoo-finance-kr market=KR error_code=yahoo_finance_kr_symbol_unresolved preview_token=PF-UNSAFE-OK matched=112",
    },
  ];
}

function buildUnresolvedItems(): ProviderUnresolvedItemDto[] {
  return [
    {
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      providerSymbol: "005930",
      state: "active",
      severity: "warning",
      occurrenceCount: 4,
      firstSeenAt: "2026-06-02T14:00:00.000Z",
      lastSeenAt: "2026-06-02T14:42:11.000Z",
      lastErrorTrailId: 44,
      evidence: { exchange: "KOSPI" },
      resolvedAt: null,
      resolvedByOperationId: null,
      updatedAt: "2026-06-02T14:42:11.000Z",
    },
  ];
}

function buildOperationOutcomes(): ProviderOperationOutcomeDto[] {
  return [
    {
      operationId: "OP-20260602-1842",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      providerSymbol: "005930",
      action: "repair_mapping",
      state: "succeeded",
      message: "Resolved 005930 to 005930.KS.",
      errorCode: null,
      jobId: null,
      evidence: { candidateSymbol: "005930.KS" },
      startedAt: "2026-06-02T14:42:11.000Z",
      completedAt: "2026-06-02T14:42:12.000Z",
      updatedAt: "2026-06-02T14:42:12.000Z",
    },
  ];
}

function buildOperationOutcomeSummary(): ProviderOperationOutcomeSummaryDto {
  return {
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
  };
}

function buildIncidents(): ProviderIncidentDto[] {
  return [
    {
      id: "incident-yahoo-kr-005930",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      incidentKey: "other:yahoo_finance_kr_symbol_unresolved:KR:005930",
      status: "open",
      severity: "critical",
      title: "yahoo-finance-kr unresolved 005930",
      summary: "yahoo_finance_kr_symbol_unresolved: 005930",
      errorClass: "other",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      occurrenceCount: 2,
      firstSeenAt: "2026-06-02T14:40:00.000Z",
      lastSeenAt: "2026-06-02T14:42:00.000Z",
      lastErrorTrailId: 1,
      linkedOperationId: null,
      metadata: { sourceSymbol: "005930" },
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      resolvedAt: null,
      resolvedByUserId: null,
      ignoredAt: null,
      ignoredByUserId: null,
      createdAt: "2026-06-02T14:40:00.000Z",
      updatedAt: "2026-06-02T14:42:00.000Z",
    },
  ];
}

function buildMappings(): ProviderResolutionMappingDto[] {
  return [
    {
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { candidate: "005930.KS", operationId: "OP-20260602-1842" },
      verifiedAt: "2026-06-02T14:42:12.000Z",
      verifiedByUserId: "admin-1",
      createdAt: "2026-06-02T14:42:12.000Z",
      updatedAt: "2026-06-02T14:42:12.000Z",
    },
  ];
}

function buildActivityItems(): ProviderActivityItemDto[] {
  return [
    {
      id: "mapping:yahoo-finance-kr:KR:005930",
      providerId: "yahoo-finance-kr",
      kind: "mapping",
      occurredAt: "2026-06-02T14:42:12.000Z",
      title: "Mapping verified",
      detail: "005930 -> 005930.KS",
      refId: "005930",
    },
  ];
}

function buildCapabilities(): ProviderOperationCapabilityDto[] {
  return [
    {
      providerId: "yahoo-finance-kr",
      supportsMappings: true,
      supportsRepair: true,
      supportsRenew: true,
      supportsRerun: true,
      supportsResolverModes: true,
      emptyMappingReason: "No durable KR mappings have been verified yet.",
      actions: [
        { action: "renew_evidence", supported: true, guardrail: "checkbox", reason: null },
        { action: "repair_mapping", supported: true, guardrail: "typed_preview", reason: null },
        { action: "rerun_backfill", supported: true, guardrail: "checkbox", reason: null },
        { action: "reverify_mapping", supported: true, guardrail: "checkbox", reason: null },
        { action: "revert_mapping", supported: true, guardrail: "typed_preview", reason: null },
        { action: "purge_logs", supported: true, guardrail: "typed_preview", reason: null },
        { action: "normalize_errors", supported: true, guardrail: "checkbox", reason: null },
        { action: "mark_unsupported", supported: true, guardrail: "none", reason: null },
        { action: "ignore_unresolved", supported: true, guardrail: "none", reason: null },
        { action: "reopen_unresolved", supported: true, guardrail: "none", reason: null },
        { action: "refresh_health", supported: true, guardrail: "none", reason: null },
      ],
    },
    {
      providerId: "finmind-tw",
      supportsMappings: false,
      supportsRepair: false,
      supportsRenew: true,
      supportsRerun: true,
      supportsResolverModes: false,
      emptyMappingReason: "FinMind TW has no provider-symbol mapping resolver yet.",
      actions: [
        { action: "renew_evidence", supported: true, guardrail: "checkbox", reason: null },
        {
          action: "repair_mapping",
          supported: false,
          guardrail: "none",
          reason: "Repair is unavailable because this provider has no mapping resolver.",
        },
        { action: "rerun_backfill", supported: true, guardrail: "checkbox", reason: null },
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
        { action: "mark_unsupported", supported: true, guardrail: "none", reason: null },
        { action: "ignore_unresolved", supported: true, guardrail: "none", reason: null },
        { action: "reopen_unresolved", supported: true, guardrail: "none", reason: null },
        { action: "refresh_health", supported: true, guardrail: "none", reason: null },
      ],
    },
  ];
}

function renderClient(root: Root, overrides: Partial<ComponentProps<typeof AdminProvidersClient>> = {}) {
  const operations = overrides.operations ?? [buildOperation()];

  act(() =>
    root.render(
      <AdminProvidersClient
        providers={[
          buildProvider(),
          buildProvider({
            providerId: "finmind-tw",
            status: "degraded",
            errorCount24h: 4,
            errorCount7d: 612,
            rateLimitCount24h: 0,
          }),
        ]}
        capabilities={buildCapabilities()}
        initialProviderId="yahoo-finance-kr"
        initialTab="overview"
        summary={buildSummary()}
        guardrails={buildGuardrails()}
        diagnostics={buildDiagnostics()}
        unresolvedItems={buildUnresolvedItems()}
        unresolvedPage={1}
        unresolvedLimit={10}
        unresolvedTotal={1}
        incidents={buildIncidents()}
        incidentsPage={1}
        incidentsLimit={10}
        incidentsTotal={1}
        mappings={buildMappings()}
        mappingsPage={1}
        mappingsLimit={10}
        mappingsTotal={1}
        activityItems={buildActivityItems()}
        activityPage={1}
        activityLimit={10}
        activityTotal={1}
        stagedOperation={operations[0] ?? null}
        operations={operations}
        operationsPage={1}
        operationsLimit={10}
        operationsTotal={operations.length}
        operationOutcomes={buildOperationOutcomes()}
        operationOutcomeSummary={buildOperationOutcomeSummary()}
        operationOutcomesPage={1}
        operationOutcomesLimit={10}
        operationOutcomesTotal={1}
        logs={buildLogs()}
        logsPage={1}
        logsLimit={10}
        logsTotal={1}
        {...overrides}
      />,
    ),
  );
}

function click(testId: string) {
  const element = document.querySelector(`[data-testid='${testId}']`) as HTMLElement | null;
  if (!element) throw new Error(`element not found: ${testId}`);
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function findElementByText(selector: string, text: string): HTMLElement {
  const element = Array.from(document.querySelectorAll(selector)).find((candidate) =>
    candidate.textContent?.trim().includes(text),
  ) as HTMLElement | undefined;
  if (!element) throw new Error(`element not found by text: ${text}`);
  return element;
}

function queryElementByText(selector: string, text: string): HTMLElement | null {
  const element = Array.from(document.querySelectorAll(selector)).find((candidate) =>
    candidate.textContent?.trim().includes(text),
  ) as HTMLElement | undefined;
  return element ?? null;
}

function updateInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function updateSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("AdminProvidersClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockRefresh.mockReset();
    mockPush.mockReset();
    mockPostJson.mockReset();
    mockPostJson.mockResolvedValue({});
    Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    vi.useRealTimers();
  });

  it("renders the provider console shell with grouped provider tabs", () => {
    renderClient(root);

    expect(document.querySelector("[data-testid='provider-console-page']")).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-title']")?.textContent ?? "").toMatch(
      /yahoo-finance-kr/i,
    );
    expect(document.querySelector("[data-testid='provider-status-badge-yahoo-finance-kr']")?.textContent ?? "").toMatch(
      /awaiting action/i,
    );
    expect(document.querySelector("[data-testid='provider-status-badge-yahoo-finance-kr']")?.getAttribute("title") ?? "").toMatch(
      /guarded admin decision/i,
    );
    expect(document.querySelector("[data-testid='provider-console-refresh']")?.getAttribute("title") ?? "").toMatch(
      /does not call the upstream provider/i,
    );
    expect(document.querySelector("[data-testid='provider-console-subtab-fixer']")?.getAttribute("title") ?? "").toMatch(
      /renew, repair, and rerun/i,
    );
    expect(document.querySelector("[data-testid='admin-providers-read-only-note']")).toBeNull();
    expect(document.querySelector("[data-testid='provider-open-fixer-yahoo-finance-kr']")).toBeNull();
  });

  it("shows admin attention status when a runtime-healthy provider has unresolved backlog", () => {
    renderClient(root, {
      providers: [
        buildProvider({
          status: "healthy",
          lastSuccessfulRun: "2026-06-03T00:00:00Z",
          errorCount24h: 0,
          errorCount7d: 0,
        }),
      ],
      diagnostics: {
        ...buildDiagnostics(),
        rows: [
          {
            providerId: "yahoo-finance-kr",
            market: "KRX",
            unresolvedCount: 27_212,
            resolverStatus: "enabled",
            severity: "critical",
            errorCode: "yahoo_finance_kr_symbol_unresolved",
          },
        ],
      },
      guardrails: {
        ...buildGuardrails(),
        healthWarningUnresolvedThreshold: 1_000,
        healthCriticalUnresolvedThreshold: 10_000,
      },
    });

    const badge = document.querySelector("[data-testid='provider-status-badge-yahoo-finance-kr']");
    expect(badge?.textContent ?? "").toMatch(/critical backlog/i);
    expect(badge?.getAttribute("title") ?? "").toMatch(/availability checks are passing/i);
    expect(document.body.textContent ?? "").toMatch(/warning starts at 1,000 and critical starts at 10,000/i);
  });

  it("switches provider-owned tabs and shows unresolved rows with disabled rerun reasons", () => {
    renderClient(root);

    click("provider-console-subtab-unresolved");

    const selection = document.querySelector("[data-testid='provider-console-selection-banner']");
    expect(selection?.textContent ?? "").toMatch(/1 rows match this filter/i);
    expect(document.body.textContent ?? "").toMatch(/005930/i);
    expect(document.body.textContent ?? "").toMatch(/4 occurrences/i);
    expect(document.body.textContent ?? "").toMatch(/rerun requires resolved mapping/i);
  });

  it("updates unresolved row lifecycle state through provider-scoped API", async () => {
    renderClient(root, { initialTab: "unresolved" });

    click("provider-console-unresolved-ignore-005930");
    await act(async () => undefined);

    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/unresolved/state",
      {
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        sourceSymbol: "005930",
        state: "ignored",
      },
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("applies unresolved filters through provider-scoped URL state", () => {
    renderClient(root, { initialTab: "unresolved" });

    const search = document.querySelector("[data-testid='provider-console-unresolved-search']") as HTMLInputElement | null;
    const state = document.querySelector("[data-testid='provider-console-unresolved-state']") as HTMLSelectElement | null;
    if (!search || !state) throw new Error("expected unresolved filters");
    updateInputValue(search, "005930");
    updateSelectValue(state, "ignored");
    click("provider-console-unresolved-apply");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&unresolvedState=ignored&unresolvedSort=last_seen_desc&unresolvedPage=1&unresolvedSearch=005930",
      { scroll: false },
    );
  });

  it("supports unresolved sort, select-all matching, and recently resolved shortcut", () => {
    renderClient(root, { initialTab: "unresolved", unresolvedTotal: 1842 });

    const sort = document.querySelector("[data-testid='provider-console-unresolved-sort']") as HTMLSelectElement | null;
    if (!sort) throw new Error("expected unresolved sort control");
    updateSelectValue(sort, "occurrence_count_desc");
    click("provider-console-unresolved-apply");
    expect(mockPush).toHaveBeenLastCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&unresolvedState=active&unresolvedSort=occurrence_count_desc&unresolvedPage=1",
      { scroll: false },
    );

    click("provider-console-select-all-matching");
    expect(document.querySelector("[data-testid='provider-console-selection-banner']")?.textContent ?? "").toMatch(
      /1,842 rows selected/i,
    );

    click("provider-console-recently-resolved");
    expect(mockPush).toHaveBeenLastCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&unresolvedState=resolved&unresolvedSort=updated_desc&unresolvedPage=1",
      { scroll: false },
    );
  });

  it("header checkbox selects and clears only visible durable rows", () => {
    renderClient(root, {
      initialTab: "unresolved",
      unresolvedTotal: 25,
      unresolvedItems: [
        ...buildUnresolvedItems(),
        {
          ...buildUnresolvedItems()[0],
          sourceSymbol: "035720",
          providerSymbol: "035720",
        },
      ],
    });

    const selectVisible = document.querySelector("[data-testid='provider-console-select-visible']") as HTMLInputElement | null;
    const rowOne = document.querySelector("[data-testid='provider-console-select-row-005930']") as HTMLInputElement | null;
    const rowTwo = document.querySelector("[data-testid='provider-console-select-row-035720']") as HTMLInputElement | null;

    act(() => {
      selectVisible?.click();
    });

    expect(rowOne?.checked).toBe(true);
    expect(rowTwo?.checked).toBe(true);
    expect(document.querySelector("[data-testid='provider-console-selection-banner']")?.textContent ?? "").toMatch(/2 rows selected/i);

    act(() => {
      selectVisible?.click();
    });

    expect(rowOne?.checked).toBe(false);
    expect(rowTwo?.checked).toBe(false);
    expect(document.querySelector("[data-testid='provider-console-selection-banner']")?.textContent ?? "").toMatch(/select visible rows or choose all matching/i);
  });

  it("bulk-ignores selected unresolved rows through a selected-items scope", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockPostJson.mockResolvedValueOnce({ operation: buildOperation({ id: "OP-BULK-IGNORE", phase: "completed" }) });
    renderClient(root, { initialTab: "unresolved" });

    click("provider-console-select-visible");
    click("provider-console-bulk-ignore");
    await act(async () => undefined);

    expect(confirmSpy).toHaveBeenCalledWith("Apply ignored to 1 selected unresolved row?");
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/unresolved/state/bulk",
      {
        scope: {
          type: "selected_items",
          items: [
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "005930",
            },
          ],
        },
        state: "ignored",
        acknowledged: true,
        typedConfirmation: undefined,
      },
    );
    expect(document.querySelector("[data-testid='provider-console-operations-table']")).not.toBeNull();
    confirmSpy.mockRestore();
  });

  it("renews selected unresolved rows through a selected-items scope", async () => {
    mockPostJson.mockResolvedValueOnce({ operation: buildOperation({ id: "OP-BULK-RENEW", phase: "running" }) });
    renderClient(root, { initialTab: "unresolved" });

    click("provider-console-select-visible");
    click("provider-console-bulk-renew");
    await act(async () => undefined);

    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/operations/renew",
      {
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        scope: {
          type: "selected_items",
          items: [
            {
              providerId: "yahoo-finance-kr",
              marketCode: "KR",
              errorCode: "yahoo_finance_kr_symbol_unresolved",
              sourceSymbol: "005930",
            },
          ],
        },
      },
    );
  });

  it("bulk-marks all matching unresolved rows unsupported with typed confirmation", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("MARK 1842 MATCHING UNSUPPORTED");
    mockPostJson.mockResolvedValueOnce({ operation: buildOperation({ id: "OP-BULK-UNSUPPORTED", phase: "completed" }) });
    renderClient(root, { initialTab: "unresolved", unresolvedTotal: 1842 });

    click("provider-console-select-all-matching");
    click("provider-console-bulk-unsupported");
    await act(async () => undefined);

    expect(promptSpy).toHaveBeenCalledWith("Type MARK 1842 MATCHING UNSUPPORTED to mark unsupported this scope.");
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/unresolved/state/bulk",
      {
        scope: {
          type: "filter",
          marketCode: "KR",
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          state: "active",
          search: undefined,
        },
        state: "unsupported",
        acknowledged: false,
        typedConfirmation: "MARK 1842 MATCHING UNSUPPORTED",
      },
    );
    expect(document.querySelector("[data-testid='provider-console-operations-table']")).not.toBeNull();
    promptSpy.mockRestore();
  });

  it("exports currently loaded unresolved rows as csv", () => {
    const anchors: HTMLAnchorElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "a") anchors.push(element as HTMLAnchorElement);
      return element;
    }) as typeof document.createElement);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderClient(root, { initialTab: "unresolved" });

    click("provider-console-bulk-export");

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.download).toMatch(/^yahoo-finance-kr-unresolved-.*\.csv$/);
    const csv = decodeURIComponent((anchors[0]?.href ?? "").split(",")[1] ?? "");
    expect(csv).toContain("providerId,marketCode,errorCode,sourceSymbol");
    expect(csv).toContain("yahoo-finance-kr,KR,yahoo_finance_kr_symbol_unresolved,005930");

    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  it("shows reopen for non-active unresolved rows", () => {
    renderClient(root, {
      initialTab: "unresolved",
      unresolvedItems: buildUnresolvedItems().map((item) => ({ ...item, state: "ignored" as const })),
    });

    expect(document.querySelector("[data-testid='provider-console-unresolved-reopen-005930']")).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-unresolved-ignore-005930']")).toBeNull();
  });

  it("reruns resolved unresolved rows through mapped provider operation API", async () => {
    renderClient(root, {
      initialTab: "unresolved",
      initialUnresolvedState: "resolved",
      unresolvedItems: buildUnresolvedItems().map((item) => ({
        ...item,
        state: "resolved" as const,
        resolvedAt: "2026-06-02T14:42:12.000Z",
        resolvedByOperationId: "OP-20260602-1842",
      })),
    });

    click("provider-console-unresolved-rerun-005930");
    await act(async () => undefined);

    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/mappings/rerun",
      {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
        acknowledged: true,
      },
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("keeps dangerous execution disabled until scope, checkbox, and typed confirmation are satisfied", () => {
    renderClient(root, { initialTab: "fixer", unresolvedTotal: 1842 });

    const executeButton = document.querySelector(
      "[data-testid='provider-console-execute-button']",
    ) as HTMLButtonElement | null;
    expect(executeButton?.disabled).toBe(true);

    const checkbox = document.querySelector(
      "[data-testid='provider-console-confirm-checkbox']",
    ) as HTMLInputElement | null;
    const input = document.querySelector(
      "[data-testid='provider-console-typed-confirmation']",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const allMatchingButton = findElementByText("button", "Use all matching filter scope");
    expect(allMatchingButton).not.toBeNull();
    act(() => {
      allMatchingButton?.click();
    });
    expect(executeButton?.disabled).toBe(true);
    act(() => {
      allMatchingButton?.click();
    });

    act(() => {
      checkbox?.click();
    });
    expect(executeButton?.disabled).toBe(true);
    expect(executeButton?.getAttribute("title") ?? "").toMatch(/typed phrase/i);

    if (input) updateInputValue(input, "EXECUTE 1842 MATCHING");

    expect(executeButton?.disabled).toBe(false);
    expect(executeButton?.getAttribute("title") ?? "").toMatch(/guarded operation preview/i);
  });

  it("renders dangerous operation previews as mobile full-screen sheets", () => {
    renderClient(root, { initialTab: "fixer" });

    const panel = document.querySelector("[data-testid='provider-console-operation-panel']") as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.className ?? "").toMatch(/fixed/);
    expect(panel?.className ?? "").toMatch(/max-h-\[92vh\]/);
    expect(panel?.className ?? "").toMatch(/rounded-t-2xl/);
    expect(document.querySelector("[data-testid='provider-console-mobile-preview-backdrop']")).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-mobile-dangerous-preview']")?.textContent ?? "").toMatch(
      /mobile dangerous operation preview sheet/i,
    );
  });

  it("shows queued operations as visible queued work with cancel-only controls", () => {
    renderClient(root, {
      initialTab: "fixer",
      initialOperationId: "OP-QUEUED",
      stagedOperation: buildOperation({
        id: "OP-QUEUED",
        phase: "queued",
        canExecute: false,
        canPause: false,
        canResume: false,
        canCancel: true,
        progressPercent: 0,
      }),
      operations: [
        buildOperation({
          id: "OP-QUEUED",
          phase: "queued",
          canExecute: false,
          canPause: false,
          canResume: false,
          canCancel: true,
          progressPercent: 0,
        }),
      ],
    });

    const providerButton = document.querySelector("[data-testid='provider-console-tab-yahoo-finance-kr']");
    expect(providerButton?.getAttribute("title") ?? "").toMatch(/1 active operations/i);
    expect(document.querySelector("[data-testid='provider-console-operation-panel']")?.textContent ?? "").toMatch(
      /operation preview/i,
    );
    expect(document.body.textContent ?? "").toMatch(/queued/i);
    expect(findElementByText("button", "Cancel")).not.toBeNull();
    expect(queryElementByText("button", "Pause")).toBeNull();
    expect(queryElementByText("button", "Resume")).toBeNull();
  });

  it("explains fixer actions and starts renew evidence operations", async () => {
    renderClient(root, { initialTab: "fixer" });

    expect(findElementByText("span", "Quote-first").getAttribute("title") ?? "").toMatch(
      /checks quote metadata before chart calls/i,
    );
    expect(findElementByText("span", "Chart-probe").getAttribute("title") ?? "").toMatch(
      /costs more provider budget/i,
    );
    expect(findElementByText("button", "Renew evidence").getAttribute("title") ?? "").toMatch(
      /does not write mappings, bars, or resolved data/i,
    );
    expect(findElementByText("button", "Preview repair").getAttribute("title") ?? "").toMatch(
      /guarded preview before writing durable provider-symbol mappings/i,
    );
    expect(findElementByText("button", "Rerun disabled").getAttribute("title") ?? "").toMatch(
      /resolved items or durable provider mappings/i,
    );

    click("provider-console-renew-evidence");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/operations/renew",
      {
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
      },
    );
  });

  it("refreshes API-backed state without an upstream provider action", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    const scrollTo = vi.mocked(window.scrollTo);
    renderClient(root);

    click("provider-console-refresh");
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(mockRefresh).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: "auto" });
    expect(document.querySelector("[data-testid='provider-console-toast']")?.textContent ?? "").toMatch(
      /reloading console state from the api/i,
    );
    act(() => {
      vi.advanceTimersByTime(1850);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 640, behavior: "auto" });
  });

  it("shows durable item outcomes in the Operations tab", () => {
    renderClient(root, { initialTab: "operations" });

    expect(document.body.textContent ?? "").toMatch(/operation item outcomes/i);
    expect(document.querySelector("[data-testid='provider-console-operation-details']")?.textContent ?? "").toMatch(/operation details/i);
    expect(document.body.textContent ?? "").toMatch(/repair mapping/i);
    expect(document.body.textContent ?? "").toMatch(/resolved 005930 to 005930\.KS/i);
  });

  it("selects operations through URL state so outcomes can reload", () => {
    renderClient(root, {
      initialTab: "operations",
      operations: [
        buildOperation({ id: "OP-FIRST", phase: "completed", canExecute: false, canRetry: true }),
        buildOperation({ id: "OP-SECOND", phase: "failed", canExecute: false, canRetry: true, progressPercent: 25 }),
      ],
      stagedOperation: null,
    });

    click("provider-console-operation-select-OP-SECOND");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=operations&operationId=OP-SECOND",
      { scroll: false },
    );
  });

  it("links selected operation details to provider-scoped logs", () => {
    renderClient(root, {
      initialTab: "operations",
      initialOperationId: "OP-LOGS",
      operations: [buildOperation({ id: "OP-LOGS", phase: "completed", canExecute: false, canRetry: true })],
      stagedOperation: null,
    });

    click("provider-console-operation-open-logs");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=logs&operationId=OP-LOGS",
      { scroll: false },
    );
  });

  it("links selected operation details to provider incidents", () => {
    renderClient(root, {
      initialTab: "operations",
      initialOperationId: "OP-INCIDENTS",
      operations: [buildOperation({ id: "OP-INCIDENTS", phase: "completed", canExecute: false, canRetry: true })],
      stagedOperation: null,
    });

    click("provider-console-operation-open-incidents");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=incidents",
      { scroll: false },
    );
  });

  it("pages provider operations through URL state", () => {
    renderClient(root, {
      initialTab: "operations",
      initialOperationId: "OP-PAGE",
      operations: [buildOperation({ id: "OP-PAGE", phase: "completed", canExecute: false, canRetry: true })],
      operationsTotal: 25,
      stagedOperation: null,
    });

    click("pagination-next");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=operations&operationsPage=2&operationId=OP-PAGE",
      { scroll: false },
    );
  });

  it("retries terminal operations through provider-scoped linked preview route", async () => {
    renderClient(root, {
      initialTab: "operations",
      operations: [
        buildOperation({
          id: "OP-COMPLETED-1",
          phase: "completed",
          canExecute: false,
          canRetry: true,
          progressPercent: 100,
        }),
      ],
      stagedOperation: null,
    });

    click("provider-console-operation-retry-OP-COMPLETED-1");
    await act(async () => undefined);

    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/operations/OP-COMPLETED-1/retry",
      {},
    );
    expect(mockRefresh).toHaveBeenCalled();
    expect(document.querySelector("[data-testid='provider-console-toast']")?.textContent ?? "").toMatch(
      /operation state changed/i,
    );
  });

  it("keeps retry disabled before an operation reaches a retryable phase", () => {
    renderClient(root, { initialTab: "operations" });

    const retryButton = document.querySelector(
      "[data-testid='provider-console-operation-retry-OP-20260602-1842']",
    ) as HTMLButtonElement | null;

    expect(retryButton?.disabled).toBe(true);
    expect(retryButton?.getAttribute("title") ?? "").toMatch(/paused, failed, cancelled, or completed/i);
  });

  it("shows log purge as a preview-first destructive action", () => {
    renderClient(root, { initialTab: "logs" });

    expect(document.body.textContent ?? "").toMatch(/raw\/system diagnostics/i);
    expect(document.body.textContent ?? "").toMatch(/preview purge/i);
    expect(document.body.textContent ?? "").toMatch(/only removes raw provider error trail rows/i);
    expect(findElementByText("button", "Preview purge").getAttribute("title") ?? "").toMatch(
      /preview eligible raw provider logs/i,
    );
  });

  it("shows mapping evidence, linked context, and starts guarded reverify operations", async () => {
    renderClient(root, { initialTab: "mappings" });

    expect(document.body.textContent ?? "").toMatch(/005930\.KS/i);
    expect(document.body.textContent ?? "").toMatch(/Operation: OP-20260602-1842/i);
    expect(document.body.textContent ?? "").toMatch(/Unresolved: 005930/i);
    click("provider-console-mapping-unresolved-link-005930");
    expect(mockPush).toHaveBeenLastCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&unresolvedState=active&unresolvedSearch=005930&unresolvedPage=1",
      { scroll: false },
    );
    click("provider-console-mapping-operation-link-005930");
    expect(mockPush).toHaveBeenLastCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=operations&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&operationId=OP-20260602-1842",
      { scroll: false },
    );
    expect(findElementByText("button", "Reverify").getAttribute("title") ?? "").toMatch(
      /create a provider operation/i,
    );
    expect(findElementByText("button", "Revert").getAttribute("title") ?? "").toMatch(
      /typing the exact phrase/i,
    );

    click("provider-console-mapping-reverify-005930");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/mappings/reverify",
      {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
      },
    );

    click("provider-console-mapping-rerun-005930");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenLastCalledWith(
      "/admin/providers/yahoo-finance-kr/mappings/rerun",
      {
        marketCode: "KR",
        sourceSymbol: "005930",
        resolverMode: "quote_first",
        acknowledged: true,
      },
    );

    click("provider-console-mapping-revert-open-005930");
    expect(document.body.textContent ?? "").toMatch(/Revert durable mapping/i);
    const executeRevert = document.querySelector(
      "[data-testid='provider-console-mapping-revert-execute-005930']",
    ) as HTMLButtonElement | null;
    expect(executeRevert?.disabled).toBe(true);
    const confirmation = document.querySelector(
      "[data-testid='provider-console-mapping-revert-confirmation-005930']",
    ) as HTMLInputElement | null;
    expect(confirmation).not.toBeNull();
    if (confirmation) updateInputValue(confirmation, "REVERT 005930");
    expect(executeRevert?.disabled).toBe(false);
    click("provider-console-mapping-revert-execute-005930");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenLastCalledWith(
      "/admin/providers/yahoo-finance-kr/mappings/revert",
      {
        marketCode: "KR",
        sourceSymbol: "005930",
        typedConfirmation: "REVERT 005930",
      },
    );
  });

  it("navigates provider tab changes through provider-scoped server data", () => {
    renderClient(root);

    click("provider-console-tab-finmind-tw");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=finmind-tw&tab=unresolved&resolverMode=quote_first&errorCode=provider_symbol_unresolved",
      { scroll: false },
    );
  });

  it("keeps provider subtab selection in provider-scoped URL state", () => {
    renderClient(root, { initialTab: "unresolved" });

    click("provider-console-subtab-operations");

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=operations&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
      { scroll: false },
    );
  });

  it("offers mobile provider selection and unresolved bottom actions", async () => {
    renderClient(root, { initialTab: "unresolved" });

    const providerSelect = document.querySelector("[data-testid='provider-console-mobile-provider-select']") as HTMLSelectElement | null;
    expect(providerSelect).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-mobile-bottom-actions']")?.textContent ?? "").toMatch(/selected/i);

    click("provider-console-unresolved-ignore-005930");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/unresolved/state",
      expect.objectContaining({ sourceSymbol: "005930", state: "ignored" }),
    );

    if (!providerSelect) throw new Error("expected provider select");
    updateSelectValue(providerSelect, "finmind-tw");
    expect(mockPush).toHaveBeenCalledWith(
      "/admin/providers?providerId=finmind-tw&tab=unresolved&resolverMode=quote_first&errorCode=provider_symbol_unresolved",
      { scroll: false },
    );
  });
});
