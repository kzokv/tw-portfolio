import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ProviderFixerDashboardDiagnosticsDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardSummaryDto,
} from "@vakwen/shared-types";

const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import { ProviderFixerClient } from "../../../components/admin/ProviderFixerClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

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

function renderClient(root: Root, overrides: Partial<ComponentProps<typeof ProviderFixerClient>> = {}) {
  const operations = overrides.operations ?? [
    buildOperation(),
    buildOperation({
      id: "OP-20260602-0012",
      phase: "staged",
      dangerous: false,
      preview: {
        ...buildOperation().preview,
        token: "PF-EXEC-TRUST",
        confirmationMode: "standard",
        confirmationText: null,
      },
      canCancel: true,
    }),
  ];

  act(() =>
    root.render(
      <ProviderFixerClient
        summary={buildSummary()}
        guardrails={buildGuardrails()}
        diagnostics={buildDiagnostics()}
        stagedOperation={operations[0]}
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

describe("ProviderFixerClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockRefresh.mockReset();
    mockPush.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders summary, diagnosis, evidence, and log sections", () => {
    renderClient(root);

    expect(document.querySelector("[data-testid='provider-fixer-metric-critical']")?.textContent).toBe("1,842");
    expect(document.querySelector("[data-testid='provider-fixer-diagnosis-table']")?.textContent ?? "").toMatch(
      /yahoo-finance-kr/i,
    );
    expect(document.querySelector("[data-testid='provider-fixer-evidence-table']")?.textContent ?? "").toMatch(
      /005930\.KS/i,
    );
    expect(document.querySelector("[data-testid='provider-fixer-log-pflog-1']")?.textContent ?? "").toMatch(
      /preview_token=PF-UNSAFE-OK/i,
    );
  });

  it("diagnoses a provider row by syncing the URL-backed scope and refreshing", () => {
    renderClient(root);

    const diagnoseButton = document.querySelector(
      "[data-testid='provider-fixer-diagnose-finmind-tw']",
    ) as HTMLButtonElement | null;

    act(() => {
      diagnoseButton?.click();
    });

    expect(mockPush).toHaveBeenCalledWith(
      "/admin/provider-fixer?providerId=finmind-tw&resolverMode=quote_first&errorCode=provider_symbol_unresolved",
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("keeps dangerous execution disabled until checkbox and typed confirmation are satisfied", () => {
    renderClient(root);

    const executeButton = document.querySelector(
      "[data-testid='provider-fixer-execute-button']",
    ) as HTMLButtonElement | null;
    expect(executeButton?.disabled).toBe(true);

    const checkbox = document.querySelector(
      "[data-testid='provider-fixer-confirm-checkbox']",
    ) as HTMLInputElement | null;
    const input = document.querySelector(
      "[data-testid='provider-fixer-typed-confirmation']",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    act(() => {
      checkbox?.click();
    });
    expect(executeButton?.disabled).toBe(true);

    act(() => {
      if (!input) return;
      input.value = "EXECUTE 1842";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(executeButton?.disabled).toBe(false);
  });

  it("unlocks standard-confirm operations with the checkbox only", () => {
    const safeOperation = buildOperation({
      id: "OP-20260602-0012",
      phase: "staged",
      dangerous: false,
      preview: {
        ...buildOperation().preview,
        token: "PF-EXEC-TRUST",
        confirmationMode: "standard",
        confirmationText: null,
      },
      canCancel: true,
    });

    renderClient(root, {
      stagedOperation: safeOperation,
      operations: [safeOperation],
      operationsTotal: 1,
    });

    expect(document.querySelector("[data-testid='provider-fixer-typed-confirmation']")).toBeNull();

    const executeButton = document.querySelector(
      "[data-testid='provider-fixer-execute-button']",
    ) as HTMLButtonElement | null;
    expect(executeButton?.disabled).toBe(true);

    const checkbox = document.querySelector(
      "[data-testid='provider-fixer-confirm-checkbox']",
    ) as HTMLInputElement | null;
    act(() => {
      checkbox?.click();
    });

    expect(executeButton?.disabled).toBe(false);
    expect(document.querySelector("[data-testid='provider-fixer-danger-badge']")?.textContent ?? "").toMatch(
      /standard confirm/i,
    );
  });
});
