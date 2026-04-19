import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";

export interface TSeededAnonymousShareToken {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked";
}

/**
 * Seed a single anonymous share token — HTTP-spec variant. Caller is
 * responsible for providing a fresh request context (e.g. via a session
 * fixture that uses its own `request`).
 */
export async function seedSingleAnonymousShareToken(
  request: APIRequestContext,
  options: {
    ownerUserId: string;
    expiresInDays?: number;
    expiresAt?: string;
    revokedAt?: string;
  },
): Promise<TSeededAnonymousShareToken> {
  const expiresInDays = options.expiresInDays ?? 30;
  const response = await request.post(
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
}

export async function resetAnonymousShareRateLimit(
  request: APIRequestContext,
  ip?: string,
): Promise<void> {
  const response = await request.post(
    new URL("/__e2e/anon-share-rate-reset", TestEnv.apiBaseUrl).href,
    { data: ip ? { ip } : {} },
  );
  if (!response.ok()) {
    throw new Error(
      `anon-share-rate-reset failed: ${response.status()} ${await response.text()}`,
    );
  }
}

export async function deactivateAnonShareOwner(
  request: APIRequestContext,
  ownerUserId: string,
): Promise<void> {
  const response = await request.post(
    new URL("/__e2e/anon-share-deactivate-owner", TestEnv.apiBaseUrl).href,
    { data: { userId: ownerUserId } },
  );
  if (!response.ok()) {
    throw new Error(
      `anon-share-deactivate-owner failed: ${response.status()} ${await response.text()}`,
    );
  }
}

export async function seedInstrumentsForUser(
  request: APIRequestContext,
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
  const response = await request.post(
    new URL("/__e2e/seed-instruments", TestEnv.apiBaseUrl).href,
    {
      data: { instruments },
      headers: { "x-user-id": userId },
    },
  );
  if (!response.ok()) {
    throw new Error(`seed-instruments failed: ${response.status()} ${await response.text()}`);
  }
}
