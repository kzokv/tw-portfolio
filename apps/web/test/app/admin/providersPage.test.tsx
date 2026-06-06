import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../components/admin/AdminProvidersClient", () => ({
  AdminProvidersClient: (props: Record<string, unknown>) => (
    <div
      data-testid="admin-providers-client"
      data-props={JSON.stringify(props)}
    />
  ),
}));

import { getJson } from "../../../lib/api";
import AdminProvidersPage from "../../../app/admin/providers/page";

const getJsonMock = vi.mocked(getJson);

describe("AdminProvidersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
  });

  it("fetches every provider-console pageable surface from URL-backed query state", async () => {
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/admin/providers") {
        return { providers: [{ providerId: "yahoo-finance-kr" }], capabilities: [] };
      }
      if (path === "/admin/providers/yahoo-finance-kr/operations/summary") {
        return {
          summary: { providerId: "yahoo-finance-kr" },
          guardrails: { uiPageSize: 25 },
        };
      }
      if (path === "/admin/providers/yahoo-finance-kr/diagnostics?resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved") {
        return {
          diagnostics: { resolverMode: "quote_first", errorCode: "yahoo_finance_kr_symbol_unresolved", rows: [] },
        };
      }
      if (path === "/admin/providers/yahoo-finance-kr/unresolved?state=all&errorCode=yahoo_finance_kr_symbol_unresolved&search=005930&sort=updated_desc&page=3&limit=25") {
        return { items: [], page: 3, limit: 25, total: 0 };
      }
      if (path === "/admin/providers/yahoo-finance-kr/incidents?status=open&page=4&limit=25") {
        return { items: [], page: 4, limit: 25, total: 0 };
      }
      if (path === "/admin/providers/yahoo-finance-kr/mappings?page=5&limit=25&search=linked-op-42") {
        return { items: [], page: 5, limit: 25, total: 0 };
      }
      if (path === "/admin/providers/yahoo-finance-kr/activity?page=6&limit=25") {
        return { items: [], page: 6, limit: 25, total: 0 };
      }
      if (path === "/admin/providers/yahoo-finance-kr/operations?page=2&limit=25&includeOperationId=linked-op-42") {
        return {
          stagedOperation: null,
          selectedOperation: { id: "linked-op-42", providerId: "yahoo-finance-kr" },
          operations: [{ id: "op-on-page", providerId: "yahoo-finance-kr" }],
          page: 2,
          limit: 25,
          total: 50,
        };
      }
      if (path === "/admin/providers/yahoo-finance-kr/logs?page=7&limit=25&operationId=linked-op-42") {
        return { items: [], page: 7, limit: 25, total: 0 };
      }
      if (path === "/admin/providers/yahoo-finance-kr/operations/linked-op-42/outcomes?page=8&limit=25&state=failed&action=repair_mapping") {
        return {
          items: [{ operationId: "linked-op-42", action: "repair_mapping", state: "failed", sourceSymbol: "005930" }],
          summary: { total: 1, processed: 1, failed: 1, pending: 0, running: 0, succeeded: 0, skipped: 0, rateLimited: 0, cancelled: 0, progressPercent: 100 },
          page: 8,
          limit: 25,
          total: 1,
        };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }) as never);

    const element = await AdminProvidersPage({
      searchParams: Promise.resolve({
        providerId: "yahoo-finance-kr",
        tab: "operations",
        resolverMode: "quote_first",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        unresolvedState: "all",
        unresolvedSearch: "005930",
        unresolvedSort: "updated_desc",
        unresolvedPage: "3",
        operationsPage: "2",
        incidentsPage: "4",
        activityPage: "6",
        logsPage: "7",
        mappingsPage: "5",
        operationOutcomesPage: "8",
        operationId: "linked-op-42",
        mappingsSearch: "linked-op-42",
        operationOutcomeState: "failed",
        operationOutcomeAction: "repair_mapping",
      }),
    });

    const html = renderToStaticMarkup(element);
    const encodedProps = html.match(/data-props="([^"]+)"/)?.[1];
    if (!encodedProps) throw new Error("expected mocked AdminProvidersClient props");
    const props = JSON.parse(encodedProps.replaceAll("&quot;", "\"")) as Record<string, unknown>;

    expect(getJsonMock.mock.calls.map(([path]) => path)).toEqual([
      "/admin/providers",
      "/admin/providers/yahoo-finance-kr/operations/summary",
      "/admin/providers/yahoo-finance-kr/diagnostics?resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
      "/admin/providers/yahoo-finance-kr/unresolved?state=all&errorCode=yahoo_finance_kr_symbol_unresolved&search=005930&sort=updated_desc&page=3&limit=25",
      "/admin/providers/yahoo-finance-kr/incidents?status=open&page=4&limit=25",
      "/admin/providers/yahoo-finance-kr/mappings?page=5&limit=25&search=linked-op-42",
      "/admin/providers/yahoo-finance-kr/activity?page=6&limit=25",
      "/admin/providers/yahoo-finance-kr/operations?page=2&limit=25&includeOperationId=linked-op-42",
      "/admin/providers/yahoo-finance-kr/logs?page=7&limit=25&operationId=linked-op-42",
      "/admin/providers/yahoo-finance-kr/operations/linked-op-42/outcomes?page=8&limit=25&state=failed&action=repair_mapping",
    ]);
    expect(props.initialUnresolvedState).toBe("all");
    expect(props.mappingsPage).toBe(5);
    expect(props.logsPage).toBe(7);
    expect(props.operationsPage).toBe(2);
    expect(props.operationOutcomesPage).toBe(8);
    expect(props.initialOperationId).toBe("linked-op-42");
    expect(props.initialRequestedOperationId).toBe("linked-op-42");
    expect(props.initialOperationOutcomeState).toBe("failed");
    expect(props.initialOperationOutcomeAction).toBe("repair_mapping");
  });
});
