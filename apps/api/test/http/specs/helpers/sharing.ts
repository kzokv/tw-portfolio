import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";

export type TShareRole = "admin" | "member" | "viewer";

export interface TCreatedSession {
  cookieHeader: string;
  email: string;
  role: TShareRole;
  userId: string;
}

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

export async function createOauthSession(
  request: APIRequestContext,
  options: {
    email: string;
    name: string;
    role: TShareRole;
    sub: string;
  },
): Promise<TCreatedSession> {
  const response = await request.post(
    new URL(`/__e2e/oauth-session?role=${options.role}`, TestEnv.apiBaseUrl).href,
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
    throw new Error(`oauth session setup failed: ${response.status()} ${await response.text()}`);
  }

  const setCookie = response.headers()["set-cookie"] ?? "";
  const cookieValue = extractCookieValue(setCookie, TestEnv.sessionCookieName);
  if (!cookieValue) {
    throw new Error(`Session cookie "${TestEnv.sessionCookieName}" missing from oauth session response`);
  }

  const body = await response.json() as { userId: string };
  return {
    userId: body.userId,
    email: options.email,
    role: options.role,
    cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
  };
}

export async function createDemoSession(
  request: APIRequestContext,
): Promise<{ cookieHeader: string; userId: string }> {
  const response = await request.post(new URL("/__e2e/demo-session", TestEnv.apiBaseUrl).href);
  if (!response.ok()) {
    throw new Error(`demo session setup failed: ${response.status()} ${await response.text()}`);
  }

  const setCookie = response.headers()["set-cookie"] ?? "";
  const cookieValue = extractCookieValue(setCookie, TestEnv.sessionCookieName);
  if (!cookieValue) {
    throw new Error(`Session cookie "${TestEnv.sessionCookieName}" missing from demo session response`);
  }

  const body = await response.json() as { userId: string };
  return {
    userId: body.userId,
    cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
  };
}
