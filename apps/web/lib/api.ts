/**
 * Resolves the API base URL.
 *
 * Server-side (SSR/RSC): prefer SERVER_API_BASE_URL when provided (Docker
 * container-network routing), then fall back to NEXT_PUBLIC_API_BASE_URL.
 *
 * Client-side (browser): if the baked URL targets localhost or 127.0.0.1,
 * replace the hostname with window.location.hostname instead. This ensures the
 * session cookie is always sent with API requests — cookies are scoped to
 * the exact hostname, so "localhost" cookies are not sent to "127.0.0.1" and
 * vice versa. Deriving from window.location makes the client robust to stale
 * builds where NEXT_PUBLIC_API_BASE_URL was baked with a different loopback alias.
 *
 * In production (API on a remote domain) NEXT_PUBLIC_API_BASE_URL is returned
 * unchanged on both server and client.
 */
/**
 * The public API URL — reachable by the browser. Used for links rendered into
 * HTML that the user clicks (OAuth login, logout redirects).
 * Never returns SERVER_API_BASE_URL (Docker-internal hostname).
 */
export function getApiBaseUrl(): string {
  const baked = process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.API_PORT || 4000}`;
  if (typeof window === "undefined") return baked;

  // Client-side: if the baked URL is a local loopback alias, use the browser's
  // actual hostname so the session cookie is included in API requests.
  const { hostname: bakedHost, port, protocol } = new URL(baked);
  if (bakedHost === "localhost" || bakedHost === "127.0.0.1") {
    return `${protocol}//${window.location.hostname}${port ? `:${port}` : ""}`;
  }
  return baked;
}

/**
 * The API URL for fetch() calls. On the server, prefers SERVER_API_BASE_URL
 * (Docker-internal routing) for faster server-to-server requests.
 * On the client, returns the public URL.
 */
function getFetchApiBaseUrl(): string {
  if (typeof window === "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WebEnv } = require("@tw-portfolio/config/web") as typeof import("@tw-portfolio/config/web");
      return WebEnv.SERVER_API_BASE_URL || getApiBaseUrl();
    } catch {
      return getApiBaseUrl();
    }
  }
  return getApiBaseUrl();
}

/** Public API URL — safe to render into HTML for browser navigation. */
export const API_PUBLIC = getApiBaseUrl();

/** Fetch API URL — may be Docker-internal on the server. Use for fetch() only. */
export const API_BASE = getFetchApiBaseUrl();
// Mirrors the KZO-148 backend cookie name from the locked scope doc.
const IMPERSONATION_COOKIE_NAME = "g_impersonation";
const E2E_USER_COOKIE = "tw_e2e_user";
const E2E_USER_ROLE_COOKIE = "tw_e2e_user_role";
export const API_CLIENT_ERROR_EVENT = "tw:api-client-error";

import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  CONTEXT_USER_ID_COOKIE,
  clearContextCookie,
  readContextCookie,
} from "./context";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientErrorDetail {
  code?: string;
  message: string;
  path: string;
  status: number;
}

/**
 * Headers sent with every API request for auth.
 * - When AUTH_MODE=dev_bypass the API accepts optional x-user-id; default is "user-1".
 * - tw_e2e_user cookie → x-user-id header for E2E per-test isolation.
 * - OAuth/demo: forward the session cookie so server-side fetches authenticate.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  const runtimeDevUserId = await getRuntimeDevUserId();
  if (runtimeDevUserId) {
    headers["x-user-id"] = runtimeDevUserId;
    const runtimeDevUserRole = await getRuntimeDevUserRole();
    if (runtimeDevUserRole) {
      headers["x-user-role"] = runtimeDevUserRole;
    }
  } else if (typeof window === "undefined") {
    // Server-side: forward the session cookie for OAuth/demo users.
    // credentials: "include" does NOT auto-forward cookies in Next.js server-side fetch.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cookies } = require("next/headers") as typeof import("next/headers");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { WebEnv } = require("@tw-portfolio/config/web") as typeof import("@tw-portfolio/config/web");
      const cookieStore = await cookies();
      const sessionValue = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
      const impersonationValue = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;
      const cookieParts: string[] = [];
      if (sessionValue) {
        cookieParts.push(`${WebEnv.SESSION_COOKIE_NAME}=${sessionValue}`);
      }
      if (impersonationValue) {
        cookieParts.push(`${IMPERSONATION_COOKIE_NAME}=${impersonationValue}`);
      }
      if (cookieParts.length > 0) {
        headers["cookie"] = cookieParts.join("; ");
      }
    } catch {
      // next/headers or config not available — ignore
    }
  }

  const contextUserId = await getContextUserId();
  if (contextUserId) headers["x-context-user-id"] = contextUserId;

  return headers;
}

/**
 * Reads the `tw_context_user_id` cookie. Client: `document.cookie`. Server:
 * `next/headers.cookies()`. Mirrors the `getRuntimeDevUserId()` pattern.
 */
async function getContextUserId(): Promise<string> {
  if (typeof document !== "undefined") {
    return readContextCookie() ?? "";
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cookies } = require("next/headers") as typeof import("next/headers");
    const cookieStore = await cookies();
    const raw = cookieStore.get(CONTEXT_USER_ID_COOKIE)?.value;
    if (raw?.trim()) return decodeURIComponent(raw.trim());
  } catch {
    // next/headers not available outside of RSC render — ignore
  }
  return "";
}

/**
 * Intercepts the `x-context-fallback: revoked` response header. On match
 * (browser only): clears the context cookie and dispatches
 * `tw:context-fallback-revoked` so listeners can reset UI state. Does NOT
 * throw — the response is valid; teardown is advisory (KZO-146 design slice 8).
 */
function handleContextFallback(res: Response): void {
  if (typeof window === "undefined") return;
  if (res.headers.get("x-context-fallback") !== "revoked") return;
  clearContextCookie();
  window.dispatchEvent(new CustomEvent(CONTEXT_FALLBACK_REVOKED_EVENT));
}

async function getRuntimeDevUserRole(): Promise<string> {
  // Client-side: read from document.cookie
  if (typeof document !== "undefined") {
    const cookie = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${E2E_USER_ROLE_COOKIE}=`));

    if (cookie) {
      return decodeURIComponent(cookie.slice(E2E_USER_ROLE_COOKIE.length + 1)).trim();
    }
    return "";
  }

  // Server-side (RSC/SSR): read from next/headers cookies()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cookies } = require("next/headers") as typeof import("next/headers");
    const cookieStore = await cookies();
    const roleRaw = cookieStore.get(E2E_USER_ROLE_COOKIE)?.value;
    if (roleRaw?.trim()) return decodeURIComponent(roleRaw.trim());
  } catch {
    // next/headers not available outside of RSC render — ignore
  }

  return "";
}

async function getRuntimeDevUserId(): Promise<string> {
  // Client-side: read from document.cookie
  if (typeof document !== "undefined") {
    const cookie = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${E2E_USER_COOKIE}=`));

    if (cookie) {
      return decodeURIComponent(cookie.slice(E2E_USER_COOKIE.length + 1)).trim();
    }
    return "";
  }

  // Server-side (RSC/SSR): read from next/headers cookies()
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { cookies } = require("next/headers") as typeof import("next/headers");
    const cookieStore = await cookies();
    const e2eRaw = cookieStore.get(E2E_USER_COOKIE)?.value;
    if (e2eRaw?.trim()) return decodeURIComponent(e2eRaw.trim());
  } catch {
    // next/headers not available outside of RSC render — ignore
  }

  return "";
}

async function parseError(res: Response, path: string): Promise<ApiError> {
  let message = `Request failed: ${path}`;
  let code: string | undefined;
  try {
    const text = await res.text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { message?: string; error?: string };
        message = payload.message?.trim() || payload.error?.trim() || text;
        code = payload.error?.trim() || undefined;
      } catch {
        message = text;
      }
    }
  } catch {
    message = `Request failed: ${path}`;
  }
  return new ApiError(message, res.status, code);
}

function emitClientApiError(error: ApiError, path: string): void {
  if (typeof window === "undefined") return;
  if (error.code !== "impersonation_write_blocked") return;

  window.dispatchEvent(new CustomEvent<ApiClientErrorDetail>(API_CLIENT_ERROR_EVENT, {
    detail: {
      code: error.code,
      message: error.message,
      path,
      status: error.status,
    },
  }));
}

async function redirectToLogoutOn401<T>(res: Response, path: string): Promise<T> {
  if (res.status === 401 && typeof window !== "undefined") {
    // Session is terminating — drop any outbound-share context cookie so the
    // next login starts in the user's own context (KZO-146 design slice 17).
    clearContextCookie();
    // Demo session expired — redirect to login with message
    if (sessionStorage.getItem("isDemo")) {
      sessionStorage.removeItem("isDemo");
      window.location.href = "/login?demoExpired=true";
      return new Promise<T>(() => {});
    }
    window.location.href = `${API_PUBLIC}/auth/logout`;
    return new Promise<T>(() => {});
  }
  throw await parseError(res, path);
}

async function throwApiError<T>(res: Response, path: string): Promise<T> {
  if (res.status === 401) return redirectToLogoutOn401<T>(res, path);
  const error = await parseError(res, path);
  emitClientApiError(error, path);
  throw error;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: await getAuthHeaders(),
  });
  handleContextFallback(res);
  if (!res.ok) return throwApiError<T>(res, path);
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(body),
  });
  handleContextFallback(res);
  if (!res.ok) return throwApiError<T>(res, path);
  return res.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  handleContextFallback(res);
  if (!res.ok) return throwApiError<T>(res, path);
  return res.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  handleContextFallback(res);
  if (!res.ok) return throwApiError<T>(res, path);
  return res.json() as Promise<T>;
}

export async function deleteJson<T>(
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> },
): Promise<T> {
  const hasBody = options?.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(options?.headers ?? {}),
      ...(await getAuthHeaders()),
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });
  handleContextFallback(res);
  if (!res.ok) return throwApiError<T>(res, path);
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Anonymous share token fetchers (KZO-147) ────────────────────────────────
import type { AnonymousShareTokenDto } from "@tw-portfolio/shared-types";

export async function listAnonymousTokens(): Promise<AnonymousShareTokenDto[]> {
  const response = await getJson<{ tokens: AnonymousShareTokenDto[] }>("/share-tokens");
  return response.tokens;
}

export async function createAnonymousToken(expiresInDays: number): Promise<AnonymousShareTokenDto> {
  return postJson<AnonymousShareTokenDto>("/share-tokens", { expiresInDays });
}

export async function revokeAnonymousToken(id: string): Promise<void> {
  await deleteJson<void>(`/share-tokens/${encodeURIComponent(id)}`);
}
