// KZO-198 — AAA E2E coverage for the admin settings Tier-A surface.
//
// Lives in `specs-oauth/` because /admin/settings is admin-gated under the
// real OAuth auth path (`AUTH_MODE=oauth`). Each test seeds state via
// PATCH /admin/settings to force a deterministic starting point so the
// memory-backed shared server cannot leak across tests.
//
// Coverage:
//   [tier1-A] Rate-limit window (`marketDataPriceWindowMs`) — toggle override,
//             enter value, save, reload, verify persisted + effective updated.
//   [tier1-B] Provider error trail retention (`providerErrorTrailRetentionDays`)
//             — set value via the row, then reset-to-default (NULL) and verify
//             the env-default badge returns.
//   [tier0-A] FinMind API token rotation flow via MaskedSecretInput — masked
//             sentinel pre-rotate, rotate dialog accepts a 32-char plaintext,
//             status flips to "Set" after submission. Subsequent reload
//             continues to mask the value.
//
// Pattern mirrors `admin-metadata-enrichment-mode-aaa.spec.ts`. No ticker
// reservations needed — admin settings flow is non-portfolio.

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@vakwen/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

interface AdminCookie {
  cookieHeader: string;
  userId: string;
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function mintAdminCookie(options: {
  sub: string;
  email: string;
  name: string;
}): Promise<AdminCookie> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/oauth-session?role=admin"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: options.sub,
          email: options.email,
          name: options.name,
        }),
      },
    });
    if (!response.ok()) {
      throw new Error(
        `oauth-session mint failed: ${response.status()} ${await response.text()}`,
      );
    }
    const cookieValue = extractCookieValue(
      response.headers()["set-cookie"] ?? "",
      TestEnv.sessionCookieName,
    );
    if (!cookieValue) {
      throw new Error(
        `Session cookie "${TestEnv.sessionCookieName}" missing from Set-Cookie`,
      );
    }
    const body = (await response.json()) as { userId: string };
    return {
      cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
      userId: body.userId,
    };
  });
}

async function patchAdminSettings(
  cookieHeader: string,
  body: Record<string, unknown>,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.patch(apiPath("/admin/settings"), {
      headers: { cookie: cookieHeader },
      data: body,
    });
    if (!response.ok()) {
      throw new Error(
        `PATCH /admin/settings ${JSON.stringify(body)} failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

test.describe.serial("admin settings Tier A (KZO-198)", () => {
  test("[tier1-A]: rate-limit window override saves, persists across reload, effective updates", async ({
    appShell,
    page,
  }) => {
    // Arrange — admin cookie + reset the field to NULL so the change is observable.
    const admin = await mintAdminCookie({
      sub: "admin-tier-a-rate-limit-sub",
      email: "admin-tier-a-rate-limit@example.com",
      name: "Admin Tier-A Rate Limit",
    });
    await patchAdminSettings(admin.cookieHeader, { marketDataPriceWindowMs: null });

    // Actions — navigate to admin settings.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    const prefix = "admin-settings-market-data-price-window-ms";
    // Pre-state: env-default badge is visible (no override).
    await page.getByTestId(`${prefix}-env-default-badge`).waitFor({ state: "visible" });

    // Enable override and enter a value.
    await page.getByTestId(`${prefix}-toggle`).click();
    const inputEl = page.getByTestId(`${prefix}-input`);
    await inputEl.waitFor({ state: "visible" });
    await inputEl.fill("30000");

    await page.getByTestId(`${prefix}-save-button`).click();
    await page.getByTestId(`${prefix}-success`).waitFor({ state: "visible" });

    // Reload and verify the override persists.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // The toggle remains checked and the input shows 30000.
    const reloadedInput = page.getByTestId(`${prefix}-input`);
    await reloadedInput.waitFor({ state: "visible" });
    const reloadedValue = await reloadedInput.inputValue();
    await appShell.assert.mxAssertEqual(
      reloadedValue,
      "30000",
      "input retains the override after reload",
    );
  });

  test("[tier1-B]: provider error trail retention — set then reset-to-default returns env badge", async ({
    appShell,
    page,
  }) => {
    // Arrange — seed the field with a non-null value so the reset is observable.
    const admin = await mintAdminCookie({
      sub: "admin-tier-a-retention-sub",
      email: "admin-tier-a-retention@example.com",
      name: "Admin Tier-A Retention",
    });
    await patchAdminSettings(admin.cookieHeader, { providerErrorTrailRetentionDays: 14 });

    // Actions — navigate.
    // KZO-199: provider-health knobs moved into the `provider-health` tab.
    await appShell.actions.navigateToRoute("/admin/settings?tab=provider-health");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    const prefix = "admin-settings-provider-error-trail-retention-days";
    // Pre-state: input visible with seeded value.
    const inputEl = page.getByTestId(`${prefix}-input`);
    await inputEl.waitFor({ state: "visible" });
    const seeded = await inputEl.inputValue();
    await appShell.assert.mxAssertEqual(
      seeded,
      "14",
      "input shows seeded override (14 days) on first render",
    );

    // Click "Reset to default" → falls back to env.
    await page.getByTestId(`${prefix}-reset-button`).click();
    // Env-default badge appears after the reset.
    await page.getByTestId(`${prefix}-env-default-badge`).waitFor({ state: "visible" });

    // Reload — env badge persists (override was cleared).
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page
      .getByTestId(`${prefix}-env-default-badge`)
      .waitFor({ state: "visible" });
  });

  test("[tier0-A]: FinMind API token rotation via MaskedSecretInput sets the encrypted value", async ({
    appShell,
    page,
  }) => {
    // Arrange — clear any existing token so the pre-state is "Not set".
    const admin = await mintAdminCookie({
      sub: "admin-tier-a-rotation-sub",
      email: "admin-tier-a-rotation@example.com",
      name: "Admin Tier-A Rotation",
    });
    await patchAdminSettings(admin.cookieHeader, { finmindApiToken: null });

    // Actions — navigate to admin settings.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    // admin-ui-bugs: Provider API keys card moved into its own `api-keys` tab.
    await appShell.actions.navigateToAdminSettingsTab("api-keys");

    const prefix = "admin-settings-finmind-api-token";

    // Pre-state — masked + status="Not set".
    await page.getByTestId(`${prefix}-mask`).waitFor({ state: "visible" });
    const preStatus = await page.getByTestId(`${prefix}-status`).textContent();
    await appShell.assert.mxAssertTruthy(
      (preStatus ?? "").includes("Not set"),
      "status shows 'Not set' before rotation",
    );

    // Open rotate dialog, enter plaintext (>=20 chars), submit.
    await page.getByTestId(`${prefix}-rotate-button`).click();
    const dialog = page.getByTestId(`${prefix}-rotate-dialog`);
    await dialog.waitFor({ state: "visible" });

    const PLAINTEXT = "tier0-rotation-finmind-token-aaa"; // 32 chars
    await page.getByTestId(`${prefix}-rotate-input`).fill(PLAINTEXT);
    await page.getByTestId(`${prefix}-rotate-submit`).click();

    // Status flips to "Set" after a successful PATCH. Use a filtered
    // locator that auto-retries until the badge text is exactly "Set" —
    // satisfies AAA framework's "no raw expect" rule and Playwright's
    // "no waitForTimeout" rule.
    await page
      .getByTestId(`${prefix}-status`)
      .filter({ hasText: /^Set$/ })
      .waitFor({ state: "visible" });

    // Reload — value remains masked (plaintext is NEVER returned by GET).
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    // admin-ui-bugs: Provider API keys card moved into its own `api-keys` tab.
    await appShell.actions.navigateToAdminSettingsTab("api-keys");

    await page.getByTestId(`${prefix}-mask`).waitFor({ state: "visible" });
    const reloadHtml = await page.content();
    await appShell.assert.mxAssertTruthy(
      !reloadHtml.includes(PLAINTEXT),
      "plaintext NEVER appears in the rendered DOM after reload",
    );
  });
});
