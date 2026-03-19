import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TestEnv } from "@tw-portfolio/config/test";
import { extractCookieValue } from "../helpers/flows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, "../.auth/oauth-session.json");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

setup("authenticate with Google OAuth", async ({ request }) => {
  setup.setTimeout(30_000); // 30 seconds — no browser needed

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const apiBaseUrl = TestEnv.apiBaseUrl;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  let sessionResponse;

  if (refreshToken) {
    // Path A: Local dev with refresh token — exchange for id_token, then create session
    console.log("GOOGLE_OAUTH_REFRESH_TOKEN found — using refresh token flow (Path A).");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "GOOGLE_OAUTH_REFRESH_TOKEN is set but GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for the refresh token flow.",
      );
    }

    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      const isInvalidGrant = errorBody.includes("invalid_grant");
      const hint = isInvalidGrant
        ? "\n\nRefresh token expired or revoked. Run 'npm run auth:refresh-token' to obtain a new one."
        : "";
      throw new Error(`Google token refresh failed (${tokenRes.status}): ${errorBody}${hint}`);
    }

    const tokenData = (await tokenRes.json()) as { id_token?: string };
    if (!tokenData.id_token) {
      throw new Error("Google token refresh response did not include an id_token.");
    }

    sessionResponse = await request.post(`${apiBaseUrl}/__e2e/oauth-session`, {
      data: { id_token: tokenData.id_token },
    });
  } else {
    // Path B: CI, no refresh token — use hardcoded sub
    console.log("No GOOGLE_OAUTH_REFRESH_TOKEN — using hardcoded sub flow (Path B).");

    sessionResponse = await request.post(`${apiBaseUrl}/__e2e/oauth-session`);
  }

  if (!sessionResponse.ok()) {
    const text = await sessionResponse.text();
    throw new Error(`/__e2e/oauth-session failed (${sessionResponse.status()}): ${text}`);
  }

  const body = (await sessionResponse.json()) as { status: string; sub: string };
  console.log(`Session created for sub: ${body.sub.slice(0, 4)}...`);

  // Extract session cookie from response headers
  const setCookieHeader = sessionResponse.headers()["set-cookie"] ?? "";
  const cookieName = TestEnv.sessionCookieName;
  if (!setCookieHeader.includes(`${cookieName}=`)) {
    throw new Error(`/__e2e/oauth-session response did not set ${cookieName} cookie.`);
  }

  // Parse the cookie value
  const cookieValue = extractCookieValue(setCookieHeader, cookieName);
  if (!cookieValue) {
    throw new Error(`Could not parse ${cookieName} cookie value from Set-Cookie header.`);
  }
  const host = TestEnv.host;

  // Build storage state with the session cookie applied to both API and web origins
  const storageState = {
    cookies: [
      {
        name: cookieName,
        value: cookieValue,
        domain: host,
        path: "/",
        httpOnly: true,
        secure: cookieName.startsWith("__Host-"),
        sameSite: "Lax" as const,
        expires: -1,
      },
    ],
    origins: [],
  };

  fs.writeFileSync(authFile, JSON.stringify(storageState, null, 2));
  console.log(`Auth state saved to ${authFile}`);
});
