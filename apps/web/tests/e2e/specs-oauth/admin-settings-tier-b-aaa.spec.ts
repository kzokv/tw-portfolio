// KZO-199 — AAA E2E coverage for the admin settings Tier-B surface.
//
// Lives in `specs-oauth/` because /admin/settings is admin-gated.
//
// Coverage:
//   [tab-nav]  Tab navigation — 7 tabs render, default is `rate-limits`, URL
//              `?tab=sharing` switches to the sharing panel, testids locked per
//              architect-design.md §0.
//   [sharing-A] Sharing tab — set anonymousShareTokenCap = 1, save, verify
//               success toast and effective value update.
//   [sharing-B] Cap enforcement — with cap=1 set via PATCH, create one anon
//               share token (ok) then attempt a second (cap-exceeded → non-2xx).
//   [sharing-C] Reset to default — null PATCH clears raw; env-default badge returns.
//
// Locked testids (architect-design.md §0):
//   admin-settings-tabs
//   admin-settings-tab-{slug} (rate-limits | sharing | provider-health | backfill-repair | catalog-metadata | display-defaults | api-keys)
//   admin-settings-panel-{slug}
//   admin-settings-input-anonymousShareTokenCap
//   admin-settings-input-anonymousShareRateLimitMax
//   admin-settings-input-anonymousShareRateLimitWindowMs

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { extractCookieValue } from "@tw-portfolio/test-framework/shared";
import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

function apiPath(p: string): string {
  return new URL(p, TestEnv.apiBaseUrl).href;
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

async function createShareToken(
  cookieHeader: string,
): Promise<{ status: number; body: unknown }> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/share-tokens"), {
      headers: { cookie: cookieHeader },
      data: { expiresInDays: 7 },
    });
    const body = await response.json().catch(() => null);
    return { status: response.status(), body };
  });
}

test.describe.serial("admin settings Tier B — tab navigation + sharing knobs (KZO-199)", () => {
  test("[tab-nav]: 7 tabs render; default is rate-limits; ?tab=sharing switches panel", async ({
    appShell,
    page,
  }) => {
    // Arrange.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // ── 1. Tab list container exists ─────────────────────────────────────
    const tabsContainer = page.getByTestId("admin-settings-tabs");
    await tabsContainer.waitFor({ state: "visible" });

    // ── 2. All 7 tab triggers are present ────────────────────────────────
    // admin-ui-bugs: added `display-defaults` + `api-keys` tabs after moving
    // the two orphan cards inside <TabsRoot>.
    for (const slug of [
      "rate-limits",
      "sharing",
      "provider-health",
      "backfill-repair",
      "catalog-metadata",
      "display-defaults",
      "api-keys",
    ]) {
      const trigger = page.getByTestId(`admin-settings-tab-${slug}`);
      await trigger.waitFor({ state: "visible" });
    }

    // ── 3. Default panel is rate-limits ──────────────────────────────────
    const rateLimitsPanel = page.getByTestId("admin-settings-panel-rate-limits");
    await rateLimitsPanel.waitFor({ state: "visible" });
    // Sharing panel is not visible by default. Route the assertion through
    // the assistant's helper to comply with the AAA "no raw expect" rule.
    const sharingPanel = page.getByTestId("admin-settings-panel-sharing");
    await appShell.assert.mxAssertTruthy(
      !(await sharingPanel.isVisible()),
      "sharing panel hidden on default load",
    );

    // ── 4. Click sharing tab — panel switches ────────────────────────────
    await page.getByTestId("admin-settings-tab-sharing").click();
    await sharingPanel.waitFor({ state: "visible" });

    // URL should reflect ?tab=sharing.
    await appShell.assert.mxAssertTruthy(
      page.url().includes("tab=sharing"),
      "URL contains tab=sharing after click",
    );

    // ── 5. Navigate directly via URL with ?tab=sharing ───────────────────
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });
  });

  test("[sharing-A]: set anonymousShareTokenCap = 1 → success toast + effective updates", async ({
    appShell,
    page,
  }) => {
    // Arrange — admin cookie + reset the field to NULL so the change is observable.
    const admin = await mintAdminCookie({
      sub: "admin-tier-b-sharing-a-sub",
      email: "admin-tier-b-sharing-a@example.com",
      name: "Admin Tier-B Sharing A",
    });
    await patchAdminSettings(admin.cookieHeader, { anonymousShareTokenCap: null });

    // Navigate to /admin/settings?tab=sharing.
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });

    const prefix = "admin-settings-input-anonymousShareTokenCap";
    const toggleTestId = `${prefix.replace("input-", "")}-toggle`;

    // Pre-state: env-default badge is visible (no override).
    // The pattern follows the existing rate-limit fields: toggle → input → save → success.
    // If there is a toggle for the cap field, enable it first.
    const toggleEl = page.getByTestId(toggleTestId);
    const hasToggle = await toggleEl.count();
    // Defensive: NumericOverrideRow renders a toggle when override is null;
    // when the cap is already set it is omitted. Both branches are valid
    // arrange-paths so the conditional is intentional here.
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (hasToggle > 0) {
      const isChecked = await toggleEl.isChecked().catch(() => false);
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (!isChecked) {
        await toggleEl.click();
      }
    }

    const inputEl = page.getByTestId(prefix);
    await inputEl.waitFor({ state: "visible" });
    await inputEl.fill("1");

    const saveButton = page.getByTestId(`${prefix.replace("input-", "")}-save-button`);
    await saveButton.waitFor({ state: "visible" });
    await saveButton.click();

    // Success toast must appear.
    const successTestId = `${prefix.replace("input-", "")}-success`;
    await page.getByTestId(successTestId).waitFor({ state: "visible" });

    // Reload and confirm the override persists.
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });

    const reloadedInput = page.getByTestId(prefix);
    await reloadedInput.waitFor({ state: "visible" });
    const reloadedValue = await reloadedInput.inputValue();
    await appShell.assert.mxAssertEqual(
      reloadedValue,
      "1",
      "anonymousShareTokenCap retains override=1 after reload",
    );
  });

  test("[sharing-B]: cap=1 enforced via API — first token ok, second returns cap-exceeded", async ({
    appShell,
    page,
  }) => {
    // Arrange — admin mints an admin session, sets cap to 1.
    const admin = await mintAdminCookie({
      sub: "admin-tier-b-sharing-b-sub",
      email: "admin-tier-b-sharing-b@example.com",
      name: "Admin Tier-B Sharing B",
    });
    // Set cap to 1 via PATCH.
    await patchAdminSettings(admin.cookieHeader, { anonymousShareTokenCap: 1 });

    // We need a non-admin user cookie to create share tokens (the admin cookie IS also a user).
    // The admin.cookieHeader works fine for /share-tokens since it's an authenticated user call.
    // First token — should succeed.
    const first = await createShareToken(admin.cookieHeader);
    await appShell.assert.mxAssertTruthy(
      first.status >= 200 && first.status < 300,
      `first share token creation succeeded (status ${first.status})`,
    );

    // Second token — cap is 1, should fail (4xx).
    const second = await createShareToken(admin.cookieHeader);
    await appShell.assert.mxAssertTruthy(
      second.status >= 400,
      `second share token creation returns cap-exceeded (status ${second.status})`,
    );

    // Visual confirmation: navigate to admin settings, observe cap=1.
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });
    const capInput = page.getByTestId("admin-settings-input-anonymousShareTokenCap");
    await capInput.waitFor({ state: "visible" });
    const capValue = await capInput.inputValue();
    await appShell.assert.mxAssertEqual(
      capValue,
      "1",
      "sharing panel shows cap=1",
    );
  });

  test("[sharing-C]: reset anonymousShareTokenCap to null → env-default badge returns", async ({
    appShell,
    page,
  }) => {
    // Arrange — seed with a value so the reset is observable.
    const admin = await mintAdminCookie({
      sub: "admin-tier-b-sharing-c-sub",
      email: "admin-tier-b-sharing-c@example.com",
      name: "Admin Tier-B Sharing C",
    });
    await patchAdminSettings(admin.cookieHeader, { anonymousShareTokenCap: 5 });

    // Navigate.
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });

    const prefix = "admin-settings-input-anonymousShareTokenCap";

    // Confirm seeded value is visible.
    const inputEl = page.getByTestId(prefix);
    await inputEl.waitFor({ state: "visible" });
    const seeded = await inputEl.inputValue();
    await appShell.assert.mxAssertEqual(
      seeded,
      "5",
      "input shows seeded value=5 on first render",
    );

    // Reset to default via toggle-off / reset button.
    const resetButton = page.getByTestId(
      `${prefix.replace("input-", "")}-reset-button`,
    );
    const toggleTestId = `${prefix.replace("input-", "")}-toggle`;
    const toggleEl = page.getByTestId(toggleTestId);

    const hasReset = await resetButton.count();
    // Defensive: reset-button is rendered only when an override exists;
    // toggle path covers the "no override" arrange. Both branches are valid
    // arrange-paths.
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (hasReset > 0) {
      await resetButton.click();
    } else {
      // If there's a toggle, click it to disable the override.
      const hasToggle = await toggleEl.count();
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (hasToggle > 0) {
        await toggleEl.click();
        const saveButton = page.getByTestId(`${prefix.replace("input-", "")}-save-button`);
        const hasSave = await saveButton.count();
        // eslint-disable-next-line playwright/no-conditional-in-test
        if (hasSave > 0) {
          await saveButton.click();
        }
      }
    }

    // Env-default badge must appear after the reset.
    const badgeTestId = `${prefix.replace("input-", "")}-env-default-badge`;
    await page.getByTestId(badgeTestId).waitFor({ state: "visible" });

    // Reload — badge persists.
    await appShell.actions.navigateToRoute("/admin/settings?tab=sharing");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");
    await page.getByTestId("admin-settings-panel-sharing").waitFor({ state: "visible" });
    await page.getByTestId(badgeTestId).waitFor({ state: "visible" });
  });
});

// ── Admin UI Bugs — new tab coverage (display-defaults + api-keys) ────────────
//
// Tests that the two new tabs (`display-defaults` and `api-keys`) render
// correctly and that the orphan cards that were previously outside <TabsRoot>
// now live inside their respective tab panels.
//
// Locked testids (architect-design.md §2):
//   admin-settings-tab-display-defaults   — tab trigger
//   admin-settings-panel-display-defaults — tab panel
//   admin-settings-tab-api-keys           — tab trigger
//   admin-settings-panel-api-keys         — tab panel
//   timeframe-defaults-section            — preserved; must be inside display-defaults panel
//   admin-settings-provider-keys-section  — preserved; must be inside api-keys panel
//
// TDD-RED until the Implementer:
//   1. Extends TAB_SLUGS in AdminSettingsClient.tsx with "display-defaults" + "api-keys"
//   2. Moves the orphan <Card>s into <TabsContent value="display-defaults|api-keys">
//   Failing assertion: waitFor({state:"visible"}) on `admin-settings-tab-display-defaults`
//   times out because the tab slug is not yet in TAB_SLUGS.
//
// forceMount note: Tabs.tsx:62 uses forceMount so ALL panels are in the DOM
// regardless of active tab. Playwright `isVisible()` still returns false for
// inactive panels because Radix stamps `data-state="inactive"` and
// `data-[state=inactive]:hidden` maps to CSS `display:none`.

test.describe.serial("admin settings — display-defaults + api-keys tabs (admin-ui-bugs)", () => {
  test("[tab-display-defaults-A]: clicking display-defaults tab shows timeframe-defaults-section inside panel", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // The new tab trigger must be present in the tab list.
    const displayDefaultsTab = page.getByTestId("admin-settings-tab-display-defaults");
    await displayDefaultsTab.waitFor({ state: "visible" });

    // Click to activate the display-defaults tab.
    await displayDefaultsTab.click();

    // The panel becomes the active (visible) panel.
    const panel = page.getByTestId("admin-settings-panel-display-defaults");
    await panel.waitFor({ state: "visible" });

    // The timeframe-defaults-section card must be INSIDE this panel (not outside TabsRoot).
    const section = panel.getByTestId("timeframe-defaults-section");
    await section.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await section.isVisible(),
      "timeframe-defaults-section visible within display-defaults panel",
    );

    // URL should reflect ?tab=display-defaults (mirrors the existing tab-nav pattern).
    await appShell.assert.mxAssertTruthy(
      page.url().includes("tab=display-defaults"),
      "URL contains tab=display-defaults after click",
    );
  });

  test("[tab-api-keys-A]: clicking api-keys tab shows admin-settings-provider-keys-section inside panel", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    // The new api-keys tab trigger must be present.
    const apiKeysTab = page.getByTestId("admin-settings-tab-api-keys");
    await apiKeysTab.waitFor({ state: "visible" });

    // Click to activate.
    await apiKeysTab.click();

    // The api-keys panel becomes visible.
    const panel = page.getByTestId("admin-settings-panel-api-keys");
    await panel.waitFor({ state: "visible" });

    // The provider-keys section must be INSIDE this panel (not outside TabsRoot).
    const section = panel.getByTestId("admin-settings-provider-keys-section");
    await section.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await section.isVisible(),
      "admin-settings-provider-keys-section visible within api-keys panel",
    );

    // URL should reflect ?tab=api-keys.
    await appShell.assert.mxAssertTruthy(
      page.url().includes("tab=api-keys"),
      "URL contains tab=api-keys after click",
    );
  });

  test("[tab-display-defaults-B]: navigating to ?tab=display-defaults activates the panel", async ({
    appShell,
    page,
  }) => {
    // Direct URL navigation — mirrors the existing ?tab=sharing pattern in [tab-nav].
    await appShell.actions.navigateToRoute("/admin/settings?tab=display-defaults");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    const panel = page.getByTestId("admin-settings-panel-display-defaults");
    await panel.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await panel.isVisible(),
      "display-defaults panel visible on direct URL navigation",
    );

    // Other panels must be inactive (not visible) — rate-limits is the default so
    // it should NOT be visible when display-defaults is explicitly selected.
    const rateLimitsPanel = page.getByTestId("admin-settings-panel-rate-limits");
    await appShell.assert.mxAssertTruthy(
      !(await rateLimitsPanel.isVisible()),
      "rate-limits panel not visible when display-defaults tab is active",
    );
  });

  test("[tab-api-keys-B]: navigating to ?tab=api-keys activates the panel", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings?tab=api-keys");
    await appShell.assert.adminSettingsPageIsVisible();
    await page.waitForLoadState("load");

    const panel = page.getByTestId("admin-settings-panel-api-keys");
    await panel.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await panel.isVisible(),
      "api-keys panel visible on direct URL navigation",
    );

    // Default rate-limits panel is inactive when api-keys is selected.
    const rateLimitsPanel = page.getByTestId("admin-settings-panel-rate-limits");
    await appShell.assert.mxAssertTruthy(
      !(await rateLimitsPanel.isVisible()),
      "rate-limits panel not visible when api-keys tab is active",
    );
  });
});
