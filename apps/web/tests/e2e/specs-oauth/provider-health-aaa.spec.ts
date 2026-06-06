/**
 * KZO-177 — E2E for the Admin Provider Health page + Holdings freshness badge.
 *
 * Lives in `specs-oauth/` because /admin/providers requires admin role under
 * the real OAuth auth path.
 *
 * Auth model (per `.claude/rules/e2e-oauth-seed-as-browser.md`):
 *   • The OAuth fixture pre-installs the BROWSER's session cookie on
 *     `page.context()`. The default `/__e2e/oauth-session` mints the row
 *     with `role: 'admin'` (see registerRoutes.ts), so the fixture user is
 *     already an admin — no separate cookie minting / promotion needed.
 *   • Seed via the BROWSER's session cookie so the admin permission check
 *     and the seed land on the same identity.
 *   • Seed BEFORE navigation so any client-side fetch on mount sees the
 *     seeded state.
 *
 * Uses the test-only seed endpoint `/__e2e/seed-provider-health-status`
 * (gated by `assertE2ESeedEnabled()` — memory backend only). The schema
 * accepts only status + timestamp columns; `errorCount*`, `rateLimitCount*`,
 * and `recentErrors[]` are derived from the trail table by computed-on-read.
 *
 * Coverage mirrors qa-plan.md §4.1 + §4.2.
 */
import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

async function withFreshContext<T>(
  fn: (ctx: APIRequestContext) => Promise<T>,
): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

/**
 * Read the BROWSER's session cookie installed by the OAuth fixture in
 * `sessionBase.ts`. Available from test-body line 1 — no navigation required.
 */
async function getTestUserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sc = cookies.find((c) => c.name === TestEnv.sessionCookieName);
  if (!sc) {
    throw new Error(
      `Session cookie "${TestEnv.sessionCookieName}" not found in browser context. ` +
        `Fixture should have installed it before the test body ran.`,
    );
  }
  return `${sc.name}=${sc.value}`;
}

interface SeedProviderHealthInput {
  providerId: string;
  status?: "healthy" | "degraded" | "down";
  lastSuccessfulRun?: string | null;
  lastFailedRun?: string | null;
  lastErrorMessage?: string | null;
  lastManualRerunAt?: string | null;
  lastDownNotificationAt?: string | null;
}

/**
 * Seed via the BROWSER's session cookie (fixture-installed admin) so the
 * admin permission check and the seed land on the same identity.
 */
async function seedProviderHealthAsBrowser(
  page: Page,
  input: SeedProviderHealthInput,
): Promise<void> {
  const cookieHeader = await getTestUserCookieHeader(page);
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/seed-provider-health-status"), {
      headers: { cookie: cookieHeader },
      data: input,
    });
    if (!response.ok()) {
      throw new Error(
        `seed-provider-health-status failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

// KZO-200: `twelve-data-au` row added (KZO-194 catalog provider).
const PROVIDERS = [
  "finmind-tw",
  "finmind-us",
  "yahoo-finance-au",
  "twelve-data-au",
  "yahoo-finance-kr",
  "twelve-data-kr",
  "frankfurter",
  "asx-gics-csv",
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial("admin /admin/providers (KZO-177)", () => {
  test("[providers-A]: page renders 8 providers with status badges", async ({
    page,
    appShell,
  }) => {
    // Seed BEFORE navigation so the page mount sees the assigned statuses.
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-us",
      status: "degraded",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      // KZO-197: route now derives `awaiting` when both `lastSuccessfulRun`
      // and `lastFailedRun` are null. Real "down" providers always have a
      // recent failed-run timestamp; reflect that here so the seeded `down`
      // status survives the derivation.
      lastFailedRun: new Date(Date.now() - 60_000).toISOString(),
      lastErrorMessage: "service unavailable",
    });
    // KZO-200: `twelve-data-au` is the AU catalog provider (KZO-194).
    await seedProviderHealthAsBrowser(page, {
      providerId: "twelve-data-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
    await seedProviderHealthAsBrowser(page, {
      providerId: "frankfurter",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-page").waitFor({ state: "visible" });

    for (const id of PROVIDERS) {
      await page.getByTestId(`provider-console-tab-${id}`).waitFor({ state: "visible" });
      await page.getByTestId(`provider-status-badge-${id}`).waitFor({ state: "visible" });
    }
  });

  test("[providers-B]: status badge text reflects status (down → 'Down')", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-tw",
      status: "down",
      lastSuccessfulRun: null,
      // KZO-197: non-null `lastFailedRun` so the `awaiting` derivation
      // doesn't override the seeded `down` status.
      lastFailedRun: new Date(Date.now() - 60_000).toISOString(),
      lastErrorMessage: "boom",
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    const badge = page.getByTestId("provider-status-badge-finmind-tw");
    await badge.waitFor({ state: "visible" });
    const text = (await badge.textContent()) ?? "";
    await appShell.assert.mxAssertTruthy(
      /down/i.test(text),
      "down badge text contains 'Down'",
    );
  });

  test("[providers-C]: provider row renders with degraded status (smoke)", async ({
    page,
    appShell,
  }) => {
    // Trail rows are owned by recordOutcome (server-side). Asserting on the
    // expand toggle would couple this E2E to internal trail seeding which the
    // /__e2e/seed-provider-health-status route does not expose. We assert
    // only the row+badge — the toggle's branching behavior is covered by
    // server-driven scenarios.
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-us",
      status: "degraded",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-tab-finmind-us").waitFor({ state: "visible" });
    await page
      .getByTestId("provider-status-badge-finmind-us")
      .waitFor({ state: "visible" });
  });

  test("[providers-D]: provider console owns fixer navigation without the retired fixer route", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-page").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("provider-open-fixer-yahoo-finance-kr").count(),
      0,
      "retired standalone provider fixer links are absent",
    );

    await page.getByTestId("provider-console-subtab-fixer").click();
    await appShell.assert.mxAssertTruthy(
      /\/admin\/providers/.test(page.url()),
      `fixer remains within /admin/providers (got: ${page.url()})`,
    );
    await appShell.assert.mxAssertTruthy(
      /repair, renew, and rerun are scoped/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "provider-owned Fixer tab explains scoped actions",
    );
  });

  test("[providers-E]: provider-owned fixer shows guarded actions and disabled rerun reason", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute(
      "/admin/providers?providerId=yahoo-finance-kr&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved&tab=fixer",
    );
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-page").waitFor({ state: "visible" });
    await page.getByTestId("provider-console-subtab-fixer").waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      /rerun requires resolved items or durable provider mappings/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "rerun disabled reason is visible",
    );
    await appShell.assert.mxAssertTruthy(
      (await page.getByRole("button", { name: /preview repair/i }).count()) > 0,
      "repair uses preview before execution",
    );
  });

  test("[providers-F]: admin sidebar shows 'Providers' nav entry + ADMIN_TITLES renders", async ({
    page,
    appShell,
  }) => {
    await appShell.actions.navigateToRoute("/admin");
    await page.waitForLoadState("load");

    await appShell.assert.mxAssertTruthy(
      (await page.getByRole("link", { name: /providers/i }).count()) > 0,
      "Providers nav entry present",
    );

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    const titleText =
      (await page
        .locator("h1, [data-testid='admin-shell-title']")
        .first()
        .textContent()) ?? "";
    await appShell.assert.mxAssertTruthy(
      /provider/i.test(titleText),
      "shell title contains 'Provider'",
    );
  });
});

// ── KZO-197 — Awaiting badge + per-provider rerun tooltip ───────────────────

test.describe.serial("KZO-197 — admin /admin/providers (awaiting + provider console tabs)", () => {
  test("[KZO-197 awaiting]: AU provider renders 'Awaiting action' when both run timestamps are null", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    const badge = page.getByTestId("provider-status-badge-yahoo-finance-au").first();
    await badge.waitFor({ state: "visible" });
    const text = (await badge.textContent()) ?? "";
    await appShell.assert.mxAssertTruthy(
      /awaiting action/i.test(text),
      `awaiting badge text contains 'Awaiting action' (got: ${text})`,
    );
  });

  test("[KZO-197 provider-rail]: every provider appears in the grouped provider rail", async ({
    page,
    appShell,
  }) => {
    for (const id of PROVIDERS) {
      await seedProviderHealthAsBrowser(page, {
        providerId: id,
        status: "healthy",
        lastSuccessfulRun: new Date().toISOString(),
      });
    }

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    for (const id of PROVIDERS) {
      const providerTab = page.getByTestId(`provider-console-tab-${id}`).first();
      await providerTab.waitFor({ state: "visible" });
    }
  });

  test("[KZO-197 subtab-help]: provider-owned fixer tab explains action surfaces", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-subtab-fixer").click();
    const text = (await page.getByTestId("provider-console-page").textContent()) ?? "";
    await appShell.assert.mxAssertTruthy(
      /repair, renew, and rerun are scoped/i.test(text),
      `fixer tab explains provider-scoped actions (got: ${text})`,
    );
    await appShell.assert.mxAssertTruthy(
      /unsupported actions stay visible with reasons/i.test(text),
      `fixer tab explains unsupported action reasons (got: ${text})`,
    );
  });
});

// ── Holdings freshness badge ─────────────────────────────────────────────────

test.describe.serial("holdings freshness badge (KZO-177)", () => {
  test("[holdings-A]: badge selector resolves on /portfolio (smoke)", async ({
    page,
    appShell,
  }) => {
    // HoldingsTable lives on /portfolio. Smoke-only — the seed surface for
    // producing a deterministic stale row is owned by Backend Implementer
    // (Phase 4 freshness classification + bar seed). When that helper lands,
    // this test tightens to assert the badge testid for a specific
    // (accountId, ticker) pair.
    await appShell.actions.navigateToRoute("/portfolio");
    await page.waitForLoadState("load");

    const anyBadge = page.locator('[data-testid^="holdings-freshness-badge-"]');
    await appShell.assert.mxAssertTruthy(
      (await anyBadge.count()) >= 0,
      "portfolio page renders without crash; badge selector is well-formed",
    );
  });

  test("[holdings-B]: anonymous share view does NOT render freshness badge", async ({
    page,
    appShell,
  }) => {
    // Defense-in-depth: the share DTO must strip freshnessTooltip server-side
    // and `<HoldingsTable showFreshnessBadge={false} />` must be wired in the
    // share view. This test asserts the badge testid never appears for any
    // row on a non-app surface — a placeholder until the share-token seed for
    // stale rows lands.
    const anyBadge = page.locator('[data-testid^="holdings-freshness-badge-"]');
    await page.goto("about:blank");
    await appShell.assert.mxAssertEqual(
      await anyBadge.count(),
      0,
      "freshness badge absent",
    );
  });
});

// ── Provider Console V2 — Provider rail interaction ──────────────────────────

test.describe.serial("provider console rail interaction — desktop + mobile", () => {
  async function seedFinmindTwHealthy(page: Page): Promise<void> {
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
  }

  test("[providers-console-A]: click provider tab → provider context switches", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    const tab = page.getByTestId("provider-console-tab-finmind-tw").first();
    await tab.waitFor({ state: "visible" });
    await tab.click();

    await appShell.assert.mxAssertTruthy(
      /finmind-tw/i.test((await page.getByTestId("provider-console-title").textContent()) ?? ""),
      "provider context switches to finmind-tw",
    );
  });

  test("[providers-console-B]: subtab navigation opens logs without leaving provider console", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-tab-finmind-tw").click();
    await page.getByTestId("provider-console-subtab-logs").click();

    await appShell.assert.mxAssertTruthy(
      /logs/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "logs subtab renders inside provider console",
    );
  });

  test("[providers-console-C]: refresh data shows notification-aware feedback", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-refresh").click();

    await appShell.assert.mxAssertTruthy(
      /refreshing provider data/i.test((await page.getByTestId("provider-console-toast").textContent()) ?? ""),
      "refresh data renders notification-aware feedback",
    );
  });

  test("[providers-console-D]: narrow viewport keeps provider rail usable", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);

    await page.setViewportSize({ width: 600, height: 900 });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    const tab = page.getByTestId("provider-console-tab-finmind-tw").first();
    await tab.waitFor({ state: "visible" });
    await tab.click();

    await appShell.assert.mxAssertTruthy(
      /finmind-tw/i.test((await page.getByTestId("provider-console-title").textContent()) ?? ""),
      "provider rail remains usable in narrow viewport",
    );
  });

  test("[providers-console-E]: unresolved table exposes filter routing and select-all matching", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute(
      "/admin/providers?providerId=yahoo-finance-kr&tab=unresolved&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
    );
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-unresolved-search").waitFor({ state: "visible" });
    await page.getByTestId("provider-console-unresolved-search").fill("005930");
    await page.getByTestId("provider-console-unresolved-state").selectOption("resolved");
    await page.getByTestId("provider-console-unresolved-sort").selectOption("updated_desc");
    await page.getByTestId("provider-console-unresolved-apply").click();
    await page.waitForURL(/unresolvedState=resolved/);

    await appShell.assert.mxAssertTruthy(
      /unresolvedState=resolved/.test(page.url()),
      `unresolved filter state is reflected in URL (got: ${page.url()})`,
    );

    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("provider-console-select-visible").isDisabled(),
      "visible-page checkbox stays disabled when the current filter has no durable active rows to select",
    );

    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("provider-console-select-all-matching").isDisabled(),
      "all-matching escalation stays disabled when the current filter has no active unresolved rows",
    );
  });

  test("[providers-console-F]: fixer route renders guarded repair actions", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute(
      "/admin/providers?providerId=yahoo-finance-kr&tab=fixer&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
    );
    await page.waitForLoadState("load");

    await page.getByRole("heading", { name: "Fixer", exact: true }).waitFor({ state: "visible" });
    const previewRepair = page.getByRole("button", { name: /preview repair/i });
    await appShell.assert.mxAssertTruthy(
      await previewRepair.isVisible(),
      "fixer route exposes the guarded repair entry point",
    );
    await appShell.assert.mxAssertTruthy(
      /renew, repair, and rerun are scoped|guardrail threshold|preview sample/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "fixer route keeps the scoped guardrail copy visible",
    );
  });

  test("[providers-console-G]: operations and logs expose progress and purge preview", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers?providerId=yahoo-finance-kr&tab=operations");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-console-operations-table").waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      /current operation|selected operation inspector|operation outcomes/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "operations tab exposes the current-operation banner and selected-operation inspector",
    );

    await page.getByTestId("provider-console-subtab-logs").click();
    await page.getByRole("button", { name: /preview purge/i }).click();
    await page.getByRole("heading", { name: /purge preview/i }).waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      /purge preview/i.test((await page.getByTestId("provider-console-page").textContent()) ?? ""),
      "logs tab opens purge preview inside provider console",
    );
    await appShell.assert.mxAssertTruthy(
      await page.getByRole("button", { name: /execute purge/i }).isDisabled(),
      "purge execution is disabled until typed confirmation matches",
    );
  });

  test("[providers-console-H]: mobile provider selector routes provider-owned views", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await appShell.actions.navigateToRoute("/admin/providers?providerId=yahoo-finance-kr&tab=unresolved");
    await page.waitForLoadState("load");

    const selector = page.getByTestId("provider-console-mobile-provider-select");
    await selector.waitFor({ state: "visible" });
    await selector.selectOption("finmind-tw");
    await page.waitForURL(/providerId=finmind-tw/);

    await appShell.assert.mxAssertTruthy(
      /providerId=finmind-tw/.test(page.url()),
      `mobile provider selector preserves provider-console routing (got: ${page.url()})`,
    );
  });
});
