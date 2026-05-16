// Phase 3c — Admin Shell Rail AAA spec.
//
// Verifies the `app-sidebar-rail` element introduced in Phase 3c:
//   [rail-A] Admin user navigating to /admin/users sees the 3px warning rail
//            (data-testid="app-sidebar-rail") rendered inside AppSidebar.
//   [rail-B] Non-admin user at /dashboard does NOT see the rail — the rail is
//            admin-shell-only and must not leak into the standard user shell.
//   [rail-C] Rail persists after client-side navigation within the admin shell
//            (from /admin/users → /admin/settings), proving the rail is mounted
//            at the shell level, not per-page.
//
// Lives in specs-oauth/ (Suite 7) because admin role requires a real OAuth
// session cookie minted via `/__e2e/oauth-session?role=admin`.
//
// Testid contract (locked in architect-design.md §2):
//   app-sidebar-rail  — 3px warning rail inside AppSidebar, admin shell only.

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

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

interface SeededSession {
  cookieHeader: string;
}

async function mintAdminSession(): Promise<SeededSession> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/oauth-session?role=admin"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: "admin-shell-rail-aaa-sub",
          email: "admin-shell-rail-aaa@example.com",
          name: "Admin Shell Rail Tester",
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
    return { cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}` };
  });
}

async function mintUserSession(): Promise<SeededSession> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/oauth-session"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: "user-shell-rail-aaa-sub",
          email: "user-shell-rail-aaa@example.com",
          name: "User Shell Rail Tester",
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
    return { cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}` };
  });
}

// ── [rail-A] Admin shell shows the warning rail ───────────────────────────────

test("[rail-A] admin user at /admin/users sees app-sidebar-rail", async ({
  appShell,
  page,
}) => {
  await appShell.actions.setViewport(1440, 960);

  // Seed admin session and install into browser context
  const admin = await mintAdminSession();
  await page.context().addCookies([
    {
      name: TestEnv.sessionCookieName,
      value: admin.cookieHeader.replace(`${TestEnv.sessionCookieName}=`, ""),
      domain: "localhost",
      path: "/",
    },
  ]);

  await appShell.actions.navigateToRoute("/admin/users");
  await appShell.assert.appIsReady();

  // The admin warning rail must be visible inside the sidebar
  await appShell.assert.adminWarningRailIsVisible();
});

// ── [rail-B] User shell does NOT show the warning rail ────────────────────────

test("[rail-B] non-admin user at /dashboard has no app-sidebar-rail", async ({
  appShell,
  page,
}) => {
  await appShell.actions.setViewport(1440, 960);

  // Seed a regular (non-admin) session and install into browser context
  const user = await mintUserSession();
  await page.context().addCookies([
    {
      name: TestEnv.sessionCookieName,
      value: user.cookieHeader.replace(`${TestEnv.sessionCookieName}=`, ""),
      domain: "localhost",
      path: "/",
    },
  ]);

  await appShell.actions.navigateToRoute("/dashboard");
  await appShell.assert.appIsReady();

  // The admin rail must be completely absent (count 0) in the user shell
  await appShell.assert.adminWarningRailIsAbsent();
});

// ── [rail-C] Rail persists across admin shell client-side navigation ──────────

test("[rail-C] app-sidebar-rail persists after client-side navigation within admin shell", async ({
  appShell,
  page,
}) => {
  await appShell.actions.setViewport(1440, 960);

  // Seed admin session and install into browser context
  const admin = await mintAdminSession();
  await page.context().addCookies([
    {
      name: TestEnv.sessionCookieName,
      value: admin.cookieHeader.replace(`${TestEnv.sessionCookieName}=`, ""),
      domain: "localhost",
      path: "/",
    },
  ]);

  // Start at /admin/users — rail is visible
  await appShell.actions.navigateToRoute("/admin/users");
  await appShell.assert.appIsReady();
  await appShell.assert.adminWarningRailIsVisible();

  // Client-side navigate to /admin/settings (no full reload)
  await appShell.actions.navigateToRoute("/admin/settings");
  await appShell.assert.appIsReady();

  // Rail must still be visible — it is mounted at the shell level, not per-page
  await appShell.assert.adminWarningRailIsVisible();
});
