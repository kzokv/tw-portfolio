import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
  ProviderHealthStatusDto,
} from "@vakwen/shared-types";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
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
        initialProviderId="yahoo-finance-kr"
        initialTab="overview"
        summary={buildSummary()}
        guardrails={buildGuardrails()}
        diagnostics={buildDiagnostics()}
        stagedOperation={operations[0] ?? null}
        operations={operations}
        operationsPage={1}
        operationsLimit={10}
        operationsTotal={operations.length}
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

function updateInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AdminProvidersClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockRefresh.mockReset();
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
    expect(selection?.textContent ?? "").toMatch(/select all 1,120 matching rows/i);
    expect(document.body.textContent ?? "").toMatch(/005930\.KS/i);
    expect(document.body.textContent ?? "").toMatch(/rerun requires resolved mapping/i);
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

    if (input) updateInputValue(input, "EXECUTE 1842");

    expect(executeButton?.disabled).toBe(false);
  });

  it("refreshes API-backed state without an upstream provider action", () => {
    renderClient(root);

    click("provider-console-refresh");

    expect(mockRefresh).toHaveBeenCalled();
    expect(document.querySelector("[data-testid='provider-console-toast']")?.textContent ?? "").toMatch(
      /reloading console state from the api/i,
    );
  });
});
