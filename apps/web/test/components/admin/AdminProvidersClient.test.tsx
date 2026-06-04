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
      scopeLabel: "symbol_unresolved",
      queryBacked: true,
      page: 1,
      totalPages: 184,
      token: "PF-UNSAFE-OK",
      tokenExpiresAt: "2026-06-03T14:15:00.000Z",
      snapshotHash: "2d14f",
      matchCount: 1842,
      sampleCount: 120,
      confirmationMode: "typed",
      confirmationText: "EXECUTE 1842",
      acknowledgementLabel: "I understand this can write provider rows",
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
      evidence: { candidate: "005930.KS" },
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
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
    );

    click("provider-console-select-all-matching");
    expect(document.querySelector("[data-testid='provider-console-selection-banner']")?.textContent ?? "").toMatch(
      /1,842 rows selected/i,
    );

    click("provider-console-recently-resolved");
    expect(mockPush).toHaveBeenLastCalledWith(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&unresolvedState=resolved&unresolvedSort=updated_desc&unresolvedPage=1",
    );
  });

  it("shows reopen for non-active unresolved rows", () => {
    renderClient(root, {
      initialTab: "unresolved",
      unresolvedItems: buildUnresolvedItems().map((item) => ({ ...item, state: "ignored" as const })),
    });

    expect(document.querySelector("[data-testid='provider-console-unresolved-reopen-005930']")).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-unresolved-ignore-005930']")).toBeNull();
  });

  it("keeps dangerous execution disabled until checkbox and typed confirmation are satisfied", () => {
    renderClient(root, { initialTab: "fixer" });

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

    act(() => {
      checkbox?.click();
    });
    expect(executeButton?.disabled).toBe(true);
    expect(executeButton?.getAttribute("title") ?? "").toMatch(/typed phrase/i);

    if (input) updateInputValue(input, "EXECUTE 1842");

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

  it("explains fixer actions and resolver modes with contextual help", () => {
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
  });

  it("refreshes API-backed state without an upstream provider action", () => {
    renderClient(root);

    click("provider-console-refresh");

    expect(mockRefresh).toHaveBeenCalled();
    expect(document.querySelector("[data-testid='provider-console-toast']")?.textContent ?? "").toMatch(
      /reloading console state from the api/i,
    );
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

  it("navigates provider tab changes through provider-scoped server data", () => {
    renderClient(root);

    click("provider-console-tab-finmind-tw");

    expect(mockPush).toHaveBeenCalledWith("/admin/providers?providerId=finmind-tw&tab=unresolved");
  });

  it("offers mobile provider selection and unresolved bottom actions", async () => {
    renderClient(root, { initialTab: "unresolved" });

    const providerSelect = document.querySelector("[data-testid='provider-console-mobile-provider-select']") as HTMLSelectElement | null;
    expect(providerSelect).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-console-mobile-bottom-actions']")?.textContent ?? "").toMatch(/visible unresolved/i);

    click("provider-console-unresolved-ignore-005930");
    await act(async () => undefined);
    expect(mockPostJson).toHaveBeenCalledWith(
      "/admin/providers/yahoo-finance-kr/unresolved/state",
      expect.objectContaining({ sourceSymbol: "005930", state: "ignored" }),
    );

    if (!providerSelect) throw new Error("expected provider select");
    updateSelectValue(providerSelect, "finmind-tw");
    expect(mockPush).toHaveBeenCalledWith("/admin/providers?providerId=finmind-tw&tab=unresolved");
  });
});
