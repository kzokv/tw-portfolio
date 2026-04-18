import { request as apiRequest, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";

const E2E_USER_COOKIE = "tw_e2e_user";
const E2E_USER_ROLE_COOKIE = "tw_e2e_user_role";

function buildMockIdToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email_verified: true,
    iss: "https://accounts.google.com",
    aud: TestEnv.oauth.clientId,
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  return `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.mock-signature`;
}

/**
 * Run a callback with an isolated APIRequestContext. This is critical for seed
 * helpers that talk directly to the API: Playwright's test-scoped `request`
 * fixture shares its cookie jar with `page.context()`, so session cookies
 * minted by `/__e2e/oauth-session` or any endpoint that issues Set-Cookie leak
 * into subsequent HTTP calls. The API's hydrateAuthContext then parses that
 * cookie and overrides any `x-user-id` header, producing 403s for admin-scoped
 * calls. A fresh context starts with an empty jar and is disposed on exit.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

export interface TSeededUser {
  userId: string;
  email: string;
}

/**
 * Creates a real `users` row with a known email via the /__e2e/oauth-session
 * endpoint. Uses a fresh APIRequestContext so the minted session cookie is
 * discarded on return — prevents cookie-jar leakage into subsequent seed calls.
 */
export async function seedUser(options: {
  email: string;
  name: string;
  sub: string;
  role?: "admin" | "member" | "viewer";
}): Promise<TSeededUser> {
  const role = options.role ?? "member";
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL(`/__e2e/oauth-session?role=${role}`, TestEnv.apiBaseUrl).href,
      {
        data: {
          id_token: buildMockIdToken({
            sub: options.sub,
            email: options.email,
            name: options.name,
          }),
        },
      },
    );

    if (!response.ok()) {
      throw new Error(`oauth-session seed failed: ${response.status()} ${await response.text()}`);
    }

    const body = (await response.json()) as { userId: string };
    return { userId: body.userId, email: options.email };
  });
}

/**
 * Seed an active share from the default dev_bypass admin (user-1) to the given
 * grantee. Throws if the grantee email is not a known user. Uses a fresh
 * context so the caller's cookies (including any prior seeded user's session)
 * cannot override `x-user-id: user-1`.
 */
export async function seedResolvedShareFromAdmin(
  granteeEmail: string,
  ownerUserId: string = "user-1",
): Promise<{ shareId: string }> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(new URL("/shares", TestEnv.apiBaseUrl).href, {
      data: { email: granteeEmail },
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`seed share failed: ${response.status()} ${await response.text()}`);
    }
    const body = (await response.json()) as
      | { type: "resolved"; share: { id: string } }
      | { type: "pending"; invite: { code: string } };
    if (body.type !== "resolved") {
      throw new Error(`expected resolved share for known grantee email, got pending: ${granteeEmail}`);
    }
    return { shareId: body.share.id };
  });
}

/**
 * Swap the browser's dev_bypass identity to a specific userId + role.
 * Clears existing cookies and plants tw_e2e_user + tw_e2e_user_role.
 * `x-user-role` forwarding from tw_e2e_user_role cookie is wired in apps/web/lib/api.ts.
 */
export async function switchIdentity(
  context: BrowserContext | Page,
  options: { userId: string; role: "admin" | "member" | "viewer" },
): Promise<void> {
  const ctx = "context" in context ? context.context() : context;
  await ctx.clearCookies();
  const urlBase = new URL("/", TestEnv.appBaseUrl).href;
  await ctx.addCookies([
    { name: E2E_USER_COOKIE, value: encodeURIComponent(options.userId), url: urlBase },
    { name: E2E_USER_ROLE_COOKIE, value: options.role, url: urlBase },
  ]);
}
