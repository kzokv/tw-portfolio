import { request as apiRequest, type APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";

/**
 * Run a callback with an isolated APIRequestContext. Required for all seed
 * helpers that talk directly to the API — prevents cookie-jar leakage from
 * prior `/__e2e/oauth-session` calls into subsequent admin-scoped requests.
 * See `playwright-request-cookie-jar-isolation.md` for the full rationale.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

export interface TSeededAnonymousShareToken {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
}

/**
 * Seed a single anonymous share token owned by `ownerUserId`. Defaults to
 * 30-day expiry. Pass `testUser.userId` from the fixture when the UI assertion
 * must observe the seeded token from the test user's perspective — see
 * `e2e-seed-testuser-userid.md`.
 */
export async function seedSingleAnonymousShareToken(options: {
  ownerUserId: string;
  expiresInDays?: number;
  expiresAt?: string;
  revokedAt?: string;
}): Promise<TSeededAnonymousShareToken> {
  const expiresInDays = options.expiresInDays ?? 30;
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/seed-anonymous-share-token", TestEnv.apiBaseUrl).href,
      {
        data: {
          ownerUserId: options.ownerUserId,
          expiresInDays,
          expiresAt: options.expiresAt,
          revokedAt: options.revokedAt,
        },
        headers: { "x-user-id": options.ownerUserId },
      },
    );

    if (!response.ok()) {
      throw new Error(
        `seed-anonymous-share-token failed: ${response.status()} ${await response.text()}`,
      );
    }

    return (await response.json()) as TSeededAnonymousShareToken;
  });
}

/**
 * Seed N anonymous share tokens owned by `ownerUserId`. Useful for populating
 * near-cap (19 tokens) or at-cap (20 tokens) scenarios.
 */
export async function seedAnonymousShareTokens(options: {
  ownerUserId: string;
  count: number;
  expiresInDays?: number;
}): Promise<TSeededAnonymousShareToken[]> {
  const results: TSeededAnonymousShareToken[] = [];
  for (let i = 0; i < options.count; i += 1) {
    results.push(
      await seedSingleAnonymousShareToken({
        ownerUserId: options.ownerUserId,
        expiresInDays: options.expiresInDays,
      }),
    );
  }
  return results;
}

/**
 * Reset the in-memory anonymous-share per-IP rate-limit buckets. Call in
 * `test.beforeEach` for any spec that exercises the 429 path, so parallel runs
 * do not leak counts across tests.
 */
export async function resetAnonymousShareRateLimit(ip?: string): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/anon-share-rate-reset", TestEnv.apiBaseUrl).href,
      { data: ip ? { ip } : {} },
    );
    if (!response.ok()) {
      throw new Error(
        `anon-share-rate-reset failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

/**
 * Flip the owner's `users.active` flag (or `deleted_at`) so public view of
 * owner-soft-deleted tokens can be asserted. Per architect decision OQ-2.
 */
export async function deactivateAnonShareOwner(ownerUserId: string): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/anon-share-deactivate-owner", TestEnv.apiBaseUrl).href,
      { data: { userId: ownerUserId } },
    );
    if (!response.ok()) {
      throw new Error(
        `anon-share-deactivate-owner failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

export async function seedQuoteBars(
  bars: Array<{
    ticker: string;
    barDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source?: string;
  }>,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/seed-daily-bars", TestEnv.apiBaseUrl).href,
      { data: { bars } },
    );
    if (!response.ok()) {
      throw new Error(`seed-daily-bars failed: ${response.status()} ${await response.text()}`);
    }
  });
}

export async function seedInstrumentsForUser(
  userId: string,
  instruments: Array<{
    ticker: string;
    name: string | null;
    instrumentType: string | null;
    marketCode: string;
    barsBackfillStatus: string;
    lastRepairAt?: string | null;
    delistedAt?: string;
  }>,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/seed-instruments", TestEnv.apiBaseUrl).href,
      {
        data: { instruments },
        headers: { "x-user-id": userId },
      },
    );
    if (!response.ok()) {
      throw new Error(`seed-instruments failed: ${response.status()} ${await response.text()}`);
    }
  });
}
