import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProviderHealthStatusDto } from "@vakwen/shared-types";
import { AdminProvidersClient } from "../../../components/admin/AdminProvidersClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildProvider(overrides: Partial<ProviderHealthStatusDto> = {}): ProviderHealthStatusDto {
  return {
    providerId: "yahoo-finance-au",
    status: "healthy",
    lastSuccessfulRun: "2026-06-03T00:00:00Z",
    lastFailedRun: null,
    errorCount24h: 0,
    errorCount7d: 0,
    rateLimitCount24h: 0,
    lastErrorMessage: null,
    lastManualRerunAt: null,
    rerunCooldownMs: 1800000,
    updatedAt: "2026-06-03T00:00:00Z",
    recentErrors: [],
    ...overrides,
  };
}

function click(testId: string) {
  const element = document.querySelector(`[data-testid='${testId}']`) as HTMLElement | null;
  if (!element) throw new Error(`element not found: ${testId}`);
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AdminProvidersClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the awaiting badge state", () => {
    act(() =>
      root.render(
        <AdminProvidersClient
          providers={[
            buildProvider({
              providerId: "yahoo-finance-au",
              status: "awaiting",
              lastSuccessfulRun: null,
              lastFailedRun: null,
            }),
          ]}
        />,
      ),
    );

    const badge = document.querySelector("[data-testid='provider-status-badge-yahoo-finance-au']");
    expect(badge?.textContent ?? "").toMatch(/awaiting first run/i);
  });

  it("renders the providers page as read-only with open fixer links", () => {
    const providers = [
      buildProvider({ providerId: "yahoo-finance-kr" }),
      buildProvider({ providerId: "finmind-tw" }),
    ];

    act(() => root.render(<AdminProvidersClient providers={providers} />));

    expect(document.querySelector("[data-testid='admin-providers-read-only-note']")?.textContent ?? "").toMatch(
      /moved to provider fixer/i,
    );
    expect(document.querySelector("[data-testid='provider-rerun-btn-yahoo-finance-kr']")).toBeNull();

    const krLink = document.querySelector(
      "[data-testid='provider-open-fixer-yahoo-finance-kr']",
    ) as HTMLAnchorElement | null;
    expect(krLink).not.toBeNull();
    expect(krLink?.getAttribute("href") ?? "").toContain("/admin/provider-fixer?");
    expect(krLink?.getAttribute("href") ?? "").toContain("providerId=yahoo-finance-kr");
    expect(krLink?.getAttribute("href") ?? "").toContain("resolverMode=quote_first");

    const twLink = document.querySelector(
      "[data-testid='provider-open-fixer-finmind-tw']",
    ) as HTMLAnchorElement | null;
    expect(twLink?.getAttribute("href") ?? "").toBe("/admin/provider-fixer?providerId=finmind-tw");
  });

  it("keeps the provider help popover and updates KR copy toward fixer guardrails", async () => {
    act(() =>
      root.render(
        <AdminProvidersClient providers={[buildProvider({ providerId: "yahoo-finance-kr" })]} />,
      ),
    );

    click("provider-help-trigger-yahoo-finance-kr");
    await act(async () => {
      await Promise.resolve();
    });

    const content = document.querySelector("[data-testid='provider-help-popover-yahoo-finance-kr']");
    const text = content?.textContent ?? "";
    expect(text).toMatch(/durable kr binding proposals/i);
    expect(text).toMatch(/provider fixer/i);
  });

  it("still expands recent error trails on demand", () => {
    act(() =>
      root.render(
        <AdminProvidersClient
          providers={[
            buildProvider({
              providerId: "frankfurter",
              recentErrors: [
                {
                  id: 1,
                  occurredAt: "2026-06-03T01:23:45Z",
                  errorClass: "rate_limit",
                  errorMessage: "429 upstream",
                },
              ],
            }),
          ]}
        />,
      ),
    );

    click("provider-errors-toggle-frankfurter");

    expect(document.querySelector("[data-testid='provider-error-trail-frankfurter']")).not.toBeNull();
    expect(document.querySelector("[data-testid='provider-error-entry-1']")?.textContent ?? "").toMatch(
      /429 upstream/i,
    );
  });
});
