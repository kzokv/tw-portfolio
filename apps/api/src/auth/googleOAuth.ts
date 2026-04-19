import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  /** Override the Google token endpoint URL (used in E2E tests to point at a mock server). */
  tokenUrl?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  iat: number;
  exp: number;
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_SCOPE = "openid email profile";
export const IMPERSONATION_COOKIE_NAME = "g_impersonation";

function upstreamError(httpStatus: number, body: unknown): Error & { statusCode: number; code: string } {
  const msg = `Google token request failed: ${httpStatus} ${JSON.stringify(body)}`;
  const err = new Error(msg) as Error & { statusCode: number; code: string };
  err.statusCode = httpStatus >= 400 && httpStatus < 500 ? 400 : 502;
  err.code = httpStatus >= 400 && httpStatus < 500 ? "oauth_client_error" : "oauth_upstream_error";
  return err;
}

// ---------------------------------------------------------------------------
// Shared HMAC helpers
// ---------------------------------------------------------------------------

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function hmacVerify(data: string, receivedHmac: string, secret: string): boolean {
  const expectedHmac = hmacSign(data, secret);
  try {
    const expectedBuf = Buffer.from(expectedHmac, "hex");
    const receivedBuf = Buffer.from(receivedHmac, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

export interface SessionIdentity {
  userId: string;
  isDemo: boolean;
  sessionVersion?: number;
}

export interface ImpersonationCookieIdentity {
  adminId: string;
  targetUserId: string;
  expiresAtMs: number;
}

/** Sign a session cookie value.
 *  HMAC signs the full payload including the `demo:` prefix when isDemo=true.
 *  Stripping or adding the prefix invalidates the signature — tamper-proof by construction.
 *  For oauth cookies, sessionVersion must be a positive integer (verifySessionCookie rejects ≤0). */
export function signSessionCookie(
  userId: string,
  sessionSecret: string,
  sessionVersionOrIsDemo: number | boolean = 1,
  isDemoArg = false,
): string {
  const isDemo = typeof sessionVersionOrIsDemo === "boolean" ? sessionVersionOrIsDemo : isDemoArg;
  const sessionVersion = typeof sessionVersionOrIsDemo === "number" ? sessionVersionOrIsDemo : 1;
  if (!isDemo && (!Number.isInteger(sessionVersion) || sessionVersion <= 0)) {
    throw new Error(`signSessionCookie: sessionVersion must be a positive integer, got ${sessionVersion}`);
  }
  const payload = isDemo ? `demo:${userId}` : `${userId}.${sessionVersion}`;
  return `${payload}.${hmacSign(payload, sessionSecret)}`;
}

/**
 * Verify an HMAC-signed session cookie and extract identity.
 * Returns { userId, isDemo } if the signature is valid, or null if tampered/malformed.
 */
export function verifySessionCookie(cookieValue: string, sessionSecret: string): SessionIdentity | null {
  const parts = cookieValue.split(".");

  if (parts.length === 2) {
    const [payload, receivedHmac] = parts;
    if (!payload || !receivedHmac) return null;
    if (!payload.startsWith("demo:")) return null;
    if (!hmacVerify(payload, receivedHmac, sessionSecret)) return null;
    return { userId: payload.slice(5), isDemo: true };
  }

  if (parts.length === 3) {
    const [userId, rawSessionVersion, receivedHmac] = parts;
    if (!userId || !rawSessionVersion || !receivedHmac) return null;

    const sessionVersion = Number.parseInt(rawSessionVersion, 10);
    if (!Number.isInteger(sessionVersion) || sessionVersion <= 0) return null;

    const payload = `${userId}.${rawSessionVersion}`;
    if (!hmacVerify(payload, receivedHmac, sessionSecret)) return null;
    return { userId, isDemo: false, sessionVersion };
  }

  return null;
}

export function signImpersonationCookie(
  adminId: string,
  targetUserId: string,
  expiresAtMs: number,
  sessionSecret: string,
): string {
  if (!Number.isInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error(`signImpersonationCookie: expiresAtMs must be a positive integer, got ${expiresAtMs}`);
  }
  const payload = `${adminId}.${targetUserId}.${expiresAtMs}`;
  return `${payload}.${hmacSign(payload, sessionSecret)}`;
}

export function verifyImpersonationCookie(
  cookieValue: string,
  sessionSecret: string,
): ImpersonationCookieIdentity | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 4) return null;
  const [adminId, targetUserId, rawExpiresAtMs, receivedHmac] = parts;
  if (!adminId || !targetUserId || !rawExpiresAtMs || !receivedHmac) return null;

  const expiresAtMs = Number.parseInt(rawExpiresAtMs, 10);
  if (!Number.isInteger(expiresAtMs) || expiresAtMs <= 0) return null;

  const payload = `${adminId}.${targetUserId}.${rawExpiresAtMs}`;
  if (!hmacVerify(payload, receivedHmac, sessionSecret)) return null;
  return { adminId, targetUserId, expiresAtMs };
}

/** Generate a stateless HMAC-signed CSRF state token, optionally embedding a returnTo path. */
export function generateState(sessionSecret: string, returnTo?: string, inviteCode?: string): string {
  const nonce = randomBytes(16).toString("hex");
  if (inviteCode) {
    const encoded = returnTo ? Buffer.from(returnTo, "utf8").toString("base64url") : "";
    const payload = `${nonce}.${encoded}.${inviteCode}`;
    return `${payload}.${hmacSign(payload, sessionSecret)}`;
  }
  if (returnTo) {
    const encoded = Buffer.from(returnTo, "utf8").toString("base64url");
    const payload = `${nonce}.${encoded}`;
    return `${payload}.${hmacSign(payload, sessionSecret)}`;
  }
  return `${nonce}.${hmacSign(nonce, sessionSecret)}`;
}

/** Verify a state token generated by generateState. Returns false for any invalid or tampered input. */
export function verifyState(state: string, sessionSecret: string): boolean {
  const parts = state.split(".");
  if (parts.length < 2 || parts.length > 4) return false;
  const receivedHmac = parts.at(-1);
  if (!receivedHmac) return false;
  const payload = parts.slice(0, -1).join(".");
  if (!payload) return false;
  return hmacVerify(payload, receivedHmac, sessionSecret);
}

/** Validate a returnTo path: must be relative, no scheme, no protocol-relative. */
export function isValidReturnTo(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try {
    const url = new URL(path, "http://n");
    return url.host === "n";
  } catch {
    return false;
  }
}

/**
 * Extract and validate a returnTo path from a verified state token.
 * Returns null for 2-part states (no returnTo) or invalid paths.
 */
export function extractReturnTo(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (!parts[1]) return null;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    return isValidReturnTo(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function extractInviteCode(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const inviteCode = parts[2]?.trim();
  return inviteCode ? inviteCode : null;
}

/** Build the Google OAuth2 authorization URL. */
export function buildAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "select_account",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. Throws on non-2xx responses. */
export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(config.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw upstreamError(res.status, data);
  return data as GoogleTokenResponse;
}

/** Exchange a refresh token for a new access token. */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(config.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw upstreamError(res.status, data);
  return data as { access_token: string; expires_in: number };
}

/**
 * Decode an ID token's payload without signature verification.
 *
 * Signature verification is acceptable to skip here because:
 * 1. The token was received from Google's own token endpoint in exchange for a code
 * 2. The exchange was authenticated using our client_secret
 * 3. State parameter prevents CSRF
 *
 * Full JWKS-based signature verification can be added later (KZO-XX) if required.
 */
export function decodeIdTokenPayload(idToken: string): GoogleIdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ID token format: expected three dot-separated segments");
  }

  const payloadSegment = parts[1];
  // base64url → base64: replace - with + and _ with /
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json) as GoogleIdTokenClaims;
}
