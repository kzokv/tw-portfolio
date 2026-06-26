import { describe, expect, it } from "vitest";
import {
  providerIncidentInputFromErrorTrail,
  providerUnresolvedItemInputFromErrorTrail,
} from "../../src/services/market-data/providerErrorNormalization.js";
import type { ProviderErrorTrailRow } from "../../src/persistence/types.js";

function errorTrail(overrides: Partial<ProviderErrorTrailRow> = {}): ProviderErrorTrailRow {
  return {
    id: 42,
    providerId: "yahoo-finance-kr",
    occurredAt: "2026-06-04T10:00:00.000Z",
    errorClass: "other",
    errorMessage: "yahoo_finance_kr_symbol_unresolved: 005930",
    context: { marketCode: "KR", ticker: "005930" },
    ...overrides,
  };
}

describe("provider error normalization", () => {
  it("normalizes item-scoped KR errors into incident and unresolved item inputs", () => {
    const row = errorTrail();

    expect(providerIncidentInputFromErrorTrail(row)).toMatchObject({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      incidentKey: "other:yahoo_finance_kr_symbol_unresolved:KR:005930",
      severity: "critical",
      title: "yahoo-finance-kr unresolved 005930",
      errorClass: "other",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      lastErrorTrailId: 42,
      metadata: { sourceSymbol: "005930" },
    });

    expect(providerUnresolvedItemInputFromErrorTrail(row)).toMatchObject({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      providerSymbol: "005930",
      lastErrorTrailId: 42,
    });
  });

  it("keeps rate-limit errors as provider incidents without unresolved worklist rows", () => {
    const row = errorTrail({
      errorClass: "rate_limit",
      errorMessage: "Retry-After exhausted",
      context: null,
    });

    expect(providerIncidentInputFromErrorTrail(row)).toMatchObject({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      incidentKey: "rate_limit:rate_limit:KR:provider",
      severity: "warning",
      title: "yahoo-finance-kr rate limit",
      errorClass: "rate_limit",
      errorCode: "rate_limit",
      lastErrorTrailId: 42,
    });
    expect(providerUnresolvedItemInputFromErrorTrail(row)).toBeNull();
  });

  it("infers JP market scope from provider suffixes when context omits marketCode", () => {
    const row = errorTrail({
      providerId: "yahoo-finance-jp",
      errorMessage: "provider_symbol_unresolved: 7203",
      context: { ticker: "7203" },
    });

    expect(providerIncidentInputFromErrorTrail(row)).toMatchObject({
      providerId: "yahoo-finance-jp",
      marketCode: "JP",
      incidentKey: "other:provider_symbol_unresolved:JP:7203",
    });
    expect(providerUnresolvedItemInputFromErrorTrail(row)).toMatchObject({
      providerId: "yahoo-finance-jp",
      marketCode: "JP",
      sourceSymbol: "7203",
      providerSymbol: "7203",
    });
  });
});
