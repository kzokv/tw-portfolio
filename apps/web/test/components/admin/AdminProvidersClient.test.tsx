/**
 * KZO-197 — New behavioral cases for AdminProvidersClient.
 *
 * Coverage (QA-owned per `.claude/rules/implementer-qa-test-ownership.md`):
 *   (a) "Awaiting first run" badge renders when both run timestamps are null.
 *   (b) Tooltip-trigger info-icon present for every provider (desktop + card).
 *   (c) Status badges render text matching the new 4-state mapping.
 *   (d) 429 cooldown countdown reads `provider.rerunCooldownMs / 1000` —
 *       not the legacy hardcoded 60.
 *
 * Radix Tooltip portal content is not asserted here — it relies on
 * `useLayoutEffect` which is cosmetic-warn under jsdom per
 * `.claude/rules/radix-useLayoutEffect-jsdom.md`. Trigger presence + the
 * `formatCooldownLabel` interpolation contract (covered by
 * `apps/web/test/lib/formatCooldownLabel.test.ts`) together pin the wiring.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProviderHealthStatusDto } from "@vakwen/shared-types";

const mockPostJson = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
      public readonly retryAfterSeconds?: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  postJson: (...args: unknown[]) => mockPostJson(...args),
}));

import { AdminProvidersClient } from "../../../components/admin/AdminProvidersClient";
import { ApiError } from "../../../lib/api";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildProvider(over: Partial<ProviderHealthStatusDto> = {}): ProviderHealthStatusDto {
  return {
    providerId: "yahoo-finance-au",
    status: "healthy",
    lastSuccessfulRun: "2026-05-09T00:00:00Z",
    lastFailedRun: null,
    errorCount24h: 0,
    errorCount7d: 0,
    rateLimitCount24h: 0,
    lastErrorMessage: null,
    lastManualRerunAt: null,
    rerunCooldownMs: 30 * 60 * 1000,
    updatedAt: "2026-05-09T00:00:00Z",
    recentErrors: [],
    ...over,
  } as ProviderHealthStatusDto;
}

function click(testId: string) {
  const el = document.querySelector(`[data-testid='${testId}']`) as HTMLElement | null;
  if (!el) throw new Error(`element not found: ${testId}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AdminProvidersClient — KZO-197 awaiting + tooltip wiring", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockPostJson.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("(a) renders 'Awaiting first run' badge when both run timestamps are null", () => {
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

    const badge = document.querySelector(
      "[data-testid='provider-status-badge-yahoo-finance-au']",
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent ?? "").toMatch(/awaiting first run/i);
  });

  it("(a') renders the locked 4-state mapping (healthy / degraded / down / awaiting)", () => {
    const providers: ProviderHealthStatusDto[] = [
      buildProvider({ providerId: "finmind-tw", status: "healthy" }),
      buildProvider({ providerId: "finmind-us", status: "degraded" }),
      buildProvider({ providerId: "frankfurter", status: "down" }),
      buildProvider({
        providerId: "yahoo-finance-au",
        status: "awaiting",
        lastSuccessfulRun: null,
        lastFailedRun: null,
      }),
    ];
    act(() => root.render(<AdminProvidersClient providers={providers} />));

    expect(
      document.querySelector("[data-testid='provider-status-badge-finmind-tw']")?.textContent,
    ).toMatch(/healthy/i);
    expect(
      document.querySelector("[data-testid='provider-status-badge-finmind-us']")?.textContent,
    ).toMatch(/degraded/i);
    expect(
      document.querySelector("[data-testid='provider-status-badge-frankfurter']")?.textContent,
    ).toMatch(/down/i);
    expect(
      document.querySelector("[data-testid='provider-status-badge-yahoo-finance-au']")
        ?.textContent,
    ).toMatch(/awaiting first run/i);
  });

  it("(b) renders a popover-trigger on the provider name for every provider", () => {
    // Phase 4 — single-DOM DataTable migration. The desktop and mobile
    // variants share the same `provider-help-trigger-{id}` testid;
    // useIsSmallScreen ensures only one variant is in DOM at any viewport.
    // jsdom defaults to non-small (matchMedia stub returns matches=false),
    // so we exercise the desktop rendering here.
    const ids = [
      "finmind-tw",
      "finmind-us",
      "yahoo-finance-au",
      "twelve-data-au",
      "yahoo-finance-kr",
      "twelve-data-kr",
      "frankfurter",
      "asx-gics-csv",
    ];
    const providers = ids.map((providerId) =>
      buildProvider({ providerId, rerunCooldownMs: providerId === "yahoo-finance-au" ? 1_800_000 : 60_000 }),
    );
    act(() => root.render(<AdminProvidersClient providers={providers} />));

    for (const id of ids) {
      expect(
        document.querySelector(`[data-testid='provider-help-trigger-${id}']`),
        `trigger for ${id}`,
      ).not.toBeNull();
    }
  });

  it("(b') popover-trigger button exposes the provider id as its accessible name", () => {
    // Codex adversarial review caught the prior regression: a generic
    // `aria-label="About this provider's Re-run action"` overrode the visible
    // provider id on every trigger, so screen-reader / voice-control users
    // could not distinguish which row's name button they were targeting.
    // The accessible name now comes from the button's visible text content
    // (the provider id itself), which is what the user reads on screen.
    act(() =>
      root.render(
        <AdminProvidersClient
          providers={[buildProvider({ providerId: "yahoo-finance-au" })]}
        />,
      ),
    );
    const trigger = document.querySelector(
      "[data-testid='provider-help-trigger-yahoo-finance-au']",
    ) as HTMLElement | null;
    expect(trigger, "trigger present").not.toBeNull();
    expect(
      trigger!.hasAttribute("aria-label"),
      "trigger must NOT carry an aria-label override",
    ).toBe(false);
    expect(
      (trigger!.textContent ?? "").trim(),
      "trigger accessible name = visible text = provider id",
    ).toBe("yahoo-finance-au");
  });

  it("(d) 429 with Retry-After header → countdown honors header value (NOT rerunCooldownMs)", async () => {
    // Server says "you may retry in 30 seconds" via Retry-After. Even though
    // the AU configured cooldown is 30 minutes, the UI must honor the
    // server's actual remaining-window advice.
    const provider = buildProvider({
      providerId: "yahoo-finance-au",
      rerunCooldownMs: 30 * 60 * 1000,
    });
    mockPostJson.mockRejectedValueOnce(
      new ApiError("rate", 429, "rate_limit_exceeded", 30),
    );

    act(() => root.render(<AdminProvidersClient providers={[provider]} />));

    click("provider-rerun-btn-yahoo-finance-au");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = document.querySelector(
      "[data-testid='provider-rerun-btn-yahoo-finance-au']",
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    const label = button!.textContent ?? "";
    const m = label.match(/(\d+)\s*s/);
    expect(m, `button label contains a seconds count (got: ${label})`).not.toBeNull();
    const seconds = Number(m![1]);
    expect(
      seconds,
      "Retry-After=30 must override the configured 1800s window",
    ).toBe(30);
  });

  it("(d') 429 without Retry-After → countdown falls back to rerunCooldownMs / 1000", async () => {
    // Header absent (older API or non-route-set 429) — fall back to the
    // configured per-provider cooldown.
    const provider = buildProvider({
      providerId: "yahoo-finance-au",
      rerunCooldownMs: 30 * 60 * 1000,
    });
    mockPostJson.mockRejectedValueOnce(new ApiError("rate", 429, "rate_limit_exceeded"));

    act(() => root.render(<AdminProvidersClient providers={[provider]} />));

    click("provider-rerun-btn-yahoo-finance-au");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = document.querySelector(
      "[data-testid='provider-rerun-btn-yahoo-finance-au']",
    ) as HTMLButtonElement | null;
    const label = button!.textContent ?? "";
    const m = label.match(/(\d+)\s*s/);
    expect(m).not.toBeNull();
    expect(
      Number(m![1]),
      "fallback to AU configured cooldown when Retry-After absent",
    ).toBe(1800);
  });

  it("(d'') TW 429 with Retry-After absent → countdown = 60 (DTO-driven fallback)", async () => {
    const provider = buildProvider({
      providerId: "finmind-tw",
      rerunCooldownMs: 60_000,
    });
    mockPostJson.mockRejectedValueOnce(new ApiError("rate", 429, "rate_limit_exceeded"));

    act(() => root.render(<AdminProvidersClient providers={[provider]} />));

    click("provider-rerun-btn-finmind-tw");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = document.querySelector(
      "[data-testid='provider-rerun-btn-finmind-tw']",
    ) as HTMLButtonElement | null;
    const label = button!.textContent ?? "";
    const m = label.match(/(\d+)\s*s/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(60);
  });
});
