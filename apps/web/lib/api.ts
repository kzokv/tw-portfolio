/**
 * Resolves the API base URL.
 *
 * Server-side (SSR/RSC): use NEXT_PUBLIC_API_BASE_URL (baked at build time).
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
export function getApiBaseUrl(): string {
  // Use || (not ??) so an accidentally-baked empty string falls back to the default.
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

export const API_BASE = getApiBaseUrl();
const E2E_USER_COOKIE = "tw_e2e_user";

/**
 * Headers sent with every API request for auth.
 * - When AUTH_MODE=dev_bypass the API accepts optional x-user-id; default is "user-1".
 * - tw_e2e_user cookie → x-user-id header for E2E per-test isolation.
 */
function getAuthHeaders(): Record<string, string> {
  const runtimeDevUserId = getRuntimeDevUserId();
  if (runtimeDevUserId) {
    return { "x-user-id": runtimeDevUserId };
  }
  return {};
}

function getRuntimeDevUserId(): string {
  if (typeof document === "undefined") {
    return "";
  }

  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${E2E_USER_COOKIE}=`));

  if (!cookie) {
    return "";
  }

  return decodeURIComponent(cookie.slice(E2E_USER_COOKIE.length + 1)).trim();
}

async function parseError(res: Response, path: string): Promise<Error> {
  let message = `Request failed: ${path}`;
  try {
    const text = await res.text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { message?: string; error?: string };
        message = payload.message?.trim() || payload.error?.trim() || text;
      } catch {
        message = text;
      }
    }
  } catch {
    message = `Request failed: ${path}`;
  }
  return new Error(message);
}

async function redirectToLogoutOn401<T>(res: Response, path: string): Promise<T> {
  if (res.status === 401 && typeof window !== "undefined") {
    // Demo session expired — redirect to login with message
    if (sessionStorage.getItem("isDemo")) {
      sessionStorage.removeItem("isDemo");
      window.location.href = "/login?demoExpired=true";
      return new Promise<T>(() => {});
    }
    window.location.href = `${API_BASE}/auth/logout`;
    return new Promise<T>(() => {});
  }
  throw await parseError(res, path);
}

const defaultHeaders = (): Record<string, string> => ({ ...getAuthHeaders() });

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: defaultHeaders(),
  });
  if (!res.ok) return redirectToLogoutOn401<T>(res, path);
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
      ...defaultHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return redirectToLogoutOn401<T>(res, path);
  return res.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json", ...defaultHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) return redirectToLogoutOn401<T>(res, path);
  return res.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json", ...defaultHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) return redirectToLogoutOn401<T>(res, path);
  return res.json() as Promise<T>;
}

export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: defaultHeaders(),
  });
  if (!res.ok) return redirectToLogoutOn401<T>(res, path);
  return res.json() as Promise<T>;
}
