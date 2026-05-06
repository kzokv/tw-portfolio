// KZO-189 — AAA E2E for the admin "Metadata Enrichment Mode" section
// on `/admin/settings`.
//
// Lives in `specs-oauth/` because it exercises the admin-only settings
// route under the real OAuth auth path (`AUTH_MODE=oauth`). Each test
// uses a per-test `sub` to avoid OAuth claim pollution across tests.
// The mode is reset to null in beforeEach via a fresh PATCH so the
// shared memory-backed server cannot leak state between tests.

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { extractCookieValue } from "@tw-portfolio/test-framework/shared";
import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface AdminCookie {
  cookieHeader: string;
  userId: string;
}

async function mintAdminCookie(options: {
  sub: string;
  email: string;
  name: string;
}): Promise<AdminCookie> {
  const ctx = await apiRequest.newContext();
  try {
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
      throw new Error(`oauth-session mint failed: ${response.status()} ${await response.text()}`);
    }
    const cookieValue = extractCookieValue(
      response.headers()["set-cookie"] ?? "",
      TestEnv.sessionCookieName,
    );
    if (!cookieValue) {
      throw new Error(`Session cookie "${TestEnv.sessionCookieName}" missing from Set-Cookie`);
    }
    const body = await response.json() as { userId: string };
    return {
      cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
      userId: body.userId,
    };
  } finally {
    await ctx.dispose();
  }
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function patchMetadataEnrichmentMode(
  cookieHeader: string,
  mode: "unconditional" | "conditional" | null,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.patch(apiPath("/admin/settings"), {
      headers: { cookie: cookieHeader },
      data: { metadataEnrichmentMode: mode },
    });
    if (!response.ok()) {
      throw new Error(
        `PATCH /admin/settings {metadataEnrichmentMode:${JSON.stringify(mode)}} failed: ` +
          `${response.status()} ${await response.text()}`,
      );
    }
  });
}

async function resetMetadataEnrichmentMode(subSeed: string): Promise<AdminCookie> {
  const admin = await mintAdminCookie({
    sub: `admin-meta-enrichment-reset-${subSeed}-sub`,
    email: `admin-meta-enrichment-reset-${subSeed}@example.com`,
    name: "Admin Meta Enrichment Reset",
  });
  await patchMetadataEnrichmentMode(admin.cookieHeader, null);
  return admin;
}

// ── AAA tests ─────────────────────────────────────────────────────────────────

test.describe.serial("admin metadata enrichment mode (KZO-189)", () => {
  test("[enrichment-mode-A]: select 'unconditional' + Save → persists after reload", async ({
    appShell,
    page,
  }) => {
    // Arrange — reset to null so the change is observable.
    await resetMetadataEnrichmentMode("A");

    // Actions — navigate to admin settings.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // Select "unconditional" via the select element.
    const selectEl = page.getByTestId("admin-settings-metadata-enrichment-mode-select");
    await selectEl.selectOption("unconditional");

    // Save.
    await page.getByTestId("admin-settings-metadata-enrichment-mode-save").click();

    // Assert — success toast appears.
    const successEl = page.getByTestId("admin-settings-metadata-enrichment-mode-success");
    await successEl.waitFor({ state: "visible" });

    // Actions — full page reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // Assert — select retains 'unconditional' after reload.
    const selectValue = await page
      .getByTestId("admin-settings-metadata-enrichment-mode-select")
      .inputValue();
    await appShell.assert.mxAssertEqual(selectValue, "unconditional", "select value after reload");

    // Assert — effective display shows unconditional with admin override suffix.
    const effectiveText = await page
      .getByTestId("admin-settings-metadata-enrichment-mode-effective")
      .textContent();
    await appShell.assert.mxAssertTruthy(
      effectiveText?.includes("unconditional"),
      "effective text contains 'unconditional'",
    );
    await appShell.assert.mxAssertTruthy(
      effectiveText?.includes("admin override"),
      "effective text contains 'admin override'",
    );
  });

  test("[enrichment-mode-B]: audit log records app_config_updated after mode change", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint admin cookie; prime mode to null.
    const admin = await resetMetadataEnrichmentMode("B");

    // Actions — navigate and change mode via the UI.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    await page
      .getByTestId("admin-settings-metadata-enrichment-mode-select")
      .selectOption("unconditional");
    await page.getByTestId("admin-settings-metadata-enrichment-mode-save").click();

    const successEl = page.getByTestId("admin-settings-metadata-enrichment-mode-success");
    await successEl.waitFor({ state: "visible" });

    // Assert — audit log contains an app_config_updated entry for this actor.
    const auditBody = await withFreshContext(async (ctx) => {
      const response = await ctx.get(
        apiPath(`/admin/audit-log?action=app_config_updated&actorUserId=${admin.userId}`),
        { headers: { cookie: admin.cookieHeader } },
      );
      return response.json() as Promise<{
        items: Array<{ action: string; metadata?: Record<string, unknown> }>;
      }>;
    });

    const entry = auditBody.items.find((e) => e.action === "app_config_updated");
    await appShell.assert.mxAssertTruthy(
      entry !== undefined,
      "audit log has app_config_updated entry for this actor",
    );
    const afterMeta = entry?.metadata?.["after"] as Record<string, unknown> | undefined;
    await appShell.assert.mxAssertTruthy(
      afterMeta !== undefined && "metadataEnrichmentMode" in afterMeta,
      "audit log entry metadata.after contains metadataEnrichmentMode key",
    );
  });

  test("[enrichment-mode-C]: reset to env default (empty select) → null in DB, effective shows env suffix", async ({
    appShell,
    page,
  }) => {
    // Arrange — pre-seed to unconditional so the null-reset is observable.
    const admin = await mintAdminCookie({
      sub: "admin-meta-enrichment-c-sub",
      email: "admin-meta-enrichment-c@example.com",
      name: "Admin Meta Enrichment C",
    });
    await patchMetadataEnrichmentMode(admin.cookieHeader, "unconditional");

    // Actions — navigate, select env default (''), save.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    await page
      .getByTestId("admin-settings-metadata-enrichment-mode-select")
      .selectOption("");
    await page.getByTestId("admin-settings-metadata-enrichment-mode-save").click();

    const successEl = page.getByTestId("admin-settings-metadata-enrichment-mode-success");
    await successEl.waitFor({ state: "visible" });

    // Actions — reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // Assert — select is back to "" (env default).
    const selectValue = await page
      .getByTestId("admin-settings-metadata-enrichment-mode-select")
      .inputValue();
    await appShell.assert.mxAssertEqual(
      selectValue,
      "",
      "select value is env-default empty string after reset",
    );

    // Assert — effective shows env default suffix.
    const effectiveText = await page
      .getByTestId("admin-settings-metadata-enrichment-mode-effective")
      .textContent();
    await appShell.assert.mxAssertTruthy(
      effectiveText?.includes("env default"),
      "effective text contains 'env default'",
    );
  });
});
