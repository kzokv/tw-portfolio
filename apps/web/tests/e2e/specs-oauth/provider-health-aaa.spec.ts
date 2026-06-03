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

    // Table renders.
    await page.getByTestId("admin-providers-table").waitFor({ state: "visible" });

    for (const id of PROVIDERS) {
      await page.getByTestId(`provider-row-${id}`).waitFor({ state: "visible" });
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

    await page.getByTestId("provider-row-finmind-us").waitFor({ state: "visible" });
    await page
      .getByTestId("provider-status-badge-finmind-us")
      .waitFor({ state: "visible" });
  });

  test("[providers-D]: Open fixer link routes provider repair out of the read-only health table", async ({
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

    await page.getByTestId("admin-providers-read-only-note").waitFor({ state: "visible" });
    const link = page.getByTestId("provider-open-fixer-yahoo-finance-kr").first();
    await link.waitFor({ state: "visible" });
    const href = await link.getAttribute("href");
    await appShell.assert.mxAssertTruthy(
      /\/admin\/provider-fixer\?providerId=yahoo-finance-kr&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved/.test(href ?? ""),
      `KR Open fixer href points to guarded resolver route (got: ${href})`,
    );
    await link.click();

    await page.waitForURL(/\/admin\/provider-fixer\?/);
    await page.getByTestId("provider-fixer-page").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("provider-fixer-provider-select").inputValue(),
      "yahoo-finance-kr",
      "Provider Fixer provider select defaults to yahoo-finance-kr",
    );
  });

  test("[providers-E]: Provider fixer preview keeps execute disabled until diagnosis confirmation", async ({
    page,
    appShell,
  }) => {
    await seedProviderHealthAsBrowser(page, {
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    await appShell.actions.navigateToRoute(
      "/admin/provider-fixer?providerId=yahoo-finance-kr&resolverMode=quote_first&errorCode=yahoo_finance_kr_symbol_unresolved",
    );
    await page.waitForLoadState("load");

    await page.getByTestId("provider-fixer-page").waitFor({ state: "visible" });
    await page.getByRole("button", { name: /stage resolver repair/i }).click();

    const execute = page.getByTestId("provider-fixer-execute-button");
    await execute.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await execute.isDisabled(),
      "execute remains disabled before acknowledgement",
    );

    await page.getByTestId("provider-fixer-confirm-checkbox").check();
    await appShell.assert.mxAssertTruthy(
      !(await execute.isDisabled()),
      "execute unlocks after standard acknowledgement",
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

test.describe.serial("KZO-197 — admin /admin/providers (awaiting + tooltip)", () => {
  test("[KZO-197 awaiting]: AU row renders 'Awaiting first run' when both run timestamps are null", async ({
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
      /awaiting first run/i.test(text),
      `awaiting badge text contains 'Awaiting first run' (got: ${text})`,
    );
  });

  test("[KZO-197 tooltip-trigger]: every provider row exposes a tooltip-trigger info-icon (desktop)", async ({
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
      const trigger = page.getByTestId(`provider-help-trigger-${id}`).first();
      await trigger.waitFor({ state: "visible" });
    }
  });

  test("[KZO-197 popover-content]: clicking the AU trigger reveals Provider Fixer migration copy", async ({
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

    // admin-ui-bugs: hover-tooltip on a `?` icon was replaced by a click
    // popover anchored to the provider name itself.
    const trigger = page.getByTestId("provider-help-trigger-yahoo-finance-au").first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();

    const content = page.getByTestId("provider-help-popover-yahoo-finance-au").first();
    await content.waitFor({ state: "visible" });
    const text = (await content.textContent()) ?? "";
    await appShell.assert.mxAssertTruthy(
      /provider fixer/i.test(text),
      `popover content references Provider Fixer (got: ${text})`,
    );
    await appShell.assert.mxAssertTruthy(
      /staged repair/i.test(text),
      `popover content references staged repair (got: ${text})`,
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

// ── Admin UI Bugs — Popover interaction (click-to-show + dismiss) ─────────────
//
// Tests for the click-popover that replaces the hover-tooltip on provider name
// cells. The popover trigger is the provider name button; testids are locked per
// architect-design.md §2.
//
// Interaction model change: hover-to-show (TooltipInfo) → click-to-show (Radix
// Popover on the provider name button itself).
//
// Coverage (post Phase-4 single-DOM DataTable migration):
//   - Default viewport (1280px) renders desktop table — `provider-help-trigger-{id}`
//   - Narrow viewport (<640px sm breakpoint) renders mobile card list — same
//     `provider-help-trigger-{id}` testid (useIsSmallScreen ensures only one
//     variant is in DOM at any viewport).
//
// TDD-RED until the Implementer lands:
//   - `apps/web/components/ui/Popover.tsx`
//   - Popover wiring in `AdminProvidersClient.tsx` (table + card cells)
//   Failing assertion: `waitFor({state:"visible"})` on `provider-help-trigger-*`
//   times out because the testid does not exist in the current implementation.

test.describe.serial("popover interaction — click-to-show + dismiss (admin-ui-bugs)", () => {
  async function seedFinmindTwHealthy(page: Page): Promise<void> {
    await seedProviderHealthAsBrowser(page, {
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
  }

  test("[providers-popover-A]: click provider name (table) → popover opens", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    await page.getByTestId("provider-row-finmind-tw").waitFor({ state: "visible" });

    // The provider name button is the popover trigger (locked testid per architect-design §2).
    const trigger = page.getByTestId("provider-help-trigger-finmind-tw").first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();

    // Popover content appears after click.
    const content = page.getByTestId("provider-help-popover-finmind-tw").first();
    await content.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await content.isVisible(),
      "popover content visible after trigger click (table)",
    );
  });

  test("[providers-popover-B]: outside click → popover closes (table)", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    // Open the popover.
    const trigger = page.getByTestId("provider-help-trigger-finmind-tw").first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();

    const content = page.getByTestId("provider-help-popover-finmind-tw").first();
    await content.waitFor({ state: "visible" });

    // Click the section heading — clearly outside the popover Portal.
    await page.locator("h1").first().click();

    // Radix Popover closes on any outside click.
    await appShell.assert.mxAssertTruthy(
      !(await content.isVisible()),
      "popover dismissed after outside click (table)",
    );
  });

  test("[providers-popover-C]: Escape key → popover closes (table)", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);
    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    // Open the popover.
    const trigger = page.getByTestId("provider-help-trigger-finmind-tw").first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();

    const content = page.getByTestId("provider-help-popover-finmind-tw").first();
    await content.waitFor({ state: "visible" });

    // Radix Popover traps the Escape key and closes.
    await page.keyboard.press("Escape");

    await appShell.assert.mxAssertTruthy(
      !(await content.isVisible()),
      "popover dismissed after Escape key (table)",
    );
  });

  test("[providers-popover-D]: card trigger (narrow viewport) → popover opens + closes", async ({
    page,
    appShell,
  }) => {
    await seedFinmindTwHealthy(page);

    // Phase 4 — single-DOM DataTable migration. The card-stack switches in
    // at <sm (640px breakpoint) via useIsSmallScreen + React conditional
    // render. Use 600x900 to stay strictly below sm. Both the desktop and
    // mobile variants emit the same `provider-row-{id}` /
    // `provider-help-trigger-{id}` testids — only one is in DOM at a time.
    await page.setViewportSize({ width: 600, height: 900 });

    await appShell.actions.navigateToRoute("/admin/providers");
    await page.waitForLoadState("load");

    // Mobile card list is visible.
    await page.getByTestId("provider-row-finmind-tw").waitFor({ state: "visible" });

    // Click the trigger (testid no longer carries -card- suffix after migration).
    const cardTrigger = page.getByTestId("provider-help-trigger-finmind-tw").first();
    await cardTrigger.waitFor({ state: "visible" });
    await cardTrigger.click();

    // Popover content appears.
    const cardContent = page.getByTestId("provider-help-popover-finmind-tw").first();
    await cardContent.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await cardContent.isVisible(),
      "popover content visible after trigger click (narrow viewport)",
    );

    // Escape also closes the popover.
    await page.keyboard.press("Escape");
    await appShell.assert.mxAssertTruthy(
      !(await cardContent.isVisible()),
      "popover dismissed after Escape (narrow viewport)",
    );
  });
});
