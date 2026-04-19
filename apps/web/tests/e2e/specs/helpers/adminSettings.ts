import { request as apiRequest, type APIRequestContext } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";

/**
 * Run a callback with an isolated APIRequestContext. Prevents cookie-jar leakage
 * from the shared page context into admin-scoped seed/reset calls.
 * See `.claude/rules/playwright-request-cookie-jar-isolation.md`.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

/**
 * Reset the repair-cooldown override back to null so each E2E settings spec
 * starts from a clean "env default" state. Backed by POST /__e2e/reset-app-config
 * (gated by assertE2EResetEnabled() — dev_bypass + memory).
 */
export async function resetAppConfig(): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/reset-app-config", TestEnv.apiBaseUrl).href,
    );
    if (!response.ok()) {
      throw new Error(
        `reset-app-config failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

/**
 * Read the admin settings DTO directly from the API (bypasses the UI), so specs
 * can verify persistence after a UI save without relying on re-rendered DOM.
 */
export async function readAppConfig(actorUserId: string): Promise<{
  repairCooldownMinutes: number | null;
  effectiveRepairCooldownMinutes: number;
  updatedAt: string;
}> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.get(new URL("/admin/settings", TestEnv.apiBaseUrl).href, {
      headers: { "x-user-id": actorUserId },
    });
    if (!response.ok()) {
      throw new Error(
        `GET /admin/settings failed: ${response.status()} ${await response.text()}`,
      );
    }
    return (await response.json()) as {
      repairCooldownMinutes: number | null;
      effectiveRepairCooldownMinutes: number;
      updatedAt: string;
    };
  });
}
