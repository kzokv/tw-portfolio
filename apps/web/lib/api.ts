const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const E2E_USER_COOKIE = "tw_e2e_user";

/**
 * Headers sent with every API request for auth.
 * - When AUTH_MODE=oauth the API requires x-authenticated-user-id.
 *   Set NEXT_PUBLIC_AUTH_USER_ID in production (e.g. from gateway/session or single-user env).
 * - When AUTH_MODE=dev_bypass the API accepts optional x-user-id; default is "user-1".
 */
function getAuthHeaders(): Record<string, string> {
  const oauthUserId = typeof process.env.NEXT_PUBLIC_AUTH_USER_ID === "string"
    ? process.env.NEXT_PUBLIC_AUTH_USER_ID.trim()
    : "";
  if (oauthUserId) {
    return { "x-authenticated-user-id": oauthUserId };
  }
  const runtimeDevUserId = getRuntimeDevUserId();
  if (runtimeDevUserId) {
    return { "x-user-id": runtimeDevUserId };
  }
  const devUserId = typeof process.env.NEXT_PUBLIC_DEV_USER_ID === "string"
    ? process.env.NEXT_PUBLIC_DEV_USER_ID.trim()
    : "";
  if (devUserId) {
    return { "x-user-id": devUserId };
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

const defaultHeaders = (): Record<string, string> => ({ ...getAuthHeaders() });

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: defaultHeaders(),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
      ...defaultHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...defaultHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...defaultHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function deleteJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: defaultHeaders(),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}
