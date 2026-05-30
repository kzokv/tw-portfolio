/**
 * Client-side helpers for the portfolio-switcher context cookie (KZO-146).
 *
 * The cookie stores the owner userId of the shared portfolio the grantee is
 * currently viewing. It is:
 *   - written client-side on switcher selection
 *   - forwarded server-side by proxy.ts as `x-context-user-id`
 *   - cleared on revoke fallback / self-select / logout
 *
 * Cookie attrs (normative, per design.md §Cookie spec):
 *   Path=/; SameSite=Lax          (no HttpOnly — client reads it; no Secure in dev)
 *
 * Server components that need to read the context cookie must use
 * `next/headers.cookies()` directly (see rule: nextjs-server-cookie-access.md).
 * The helpers below are client-only and return null gracefully on the server.
 */

export const CONTEXT_USER_ID_COOKIE = "tw_context_user_id";
export const CONTEXT_CHANGED_EVENT = "tw:context-changed";
export const CONTEXT_FALLBACK_REVOKED_EVENT = "tw:context-fallback-revoked";

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

export function readContextCookie(): string | null {
  if (!isBrowser()) return null;
  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${CONTEXT_USER_ID_COOKIE}=`));
  if (!cookie) return null;
  const value = decodeURIComponent(cookie.slice(CONTEXT_USER_ID_COOKIE.length + 1)).trim();
  return value.length > 0 ? value : null;
}

function dispatchContextChanged(ownerUserId: string | null): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CONTEXT_CHANGED_EVENT, { detail: { ownerUserId } }),
  );
}

export function writeContextCookie(ownerUserId: string): void {
  if (!isBrowser()) return;
  document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent(ownerUserId)}; Path=/; SameSite=Lax`;
  dispatchContextChanged(ownerUserId);
}

export function clearContextCookie(): void {
  if (!isBrowser()) return;
  document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  dispatchContextChanged(null);
}

/**
 * One-shot handler for the `?as=<ownerUserId>` deep-link.
 *
 * If the param is present AND listed in the caller-provided allowed owner ids,
 * writes the cookie and returns the owner id. Otherwise returns null.
 *
 * The caller is responsible for stripping the param from the URL via
 * `history.replaceState` after this function returns — that keeps URLs clean
 * and avoids referrer header leakage (per scope-todo Q6).
 */
export function applyDeepLinkAs(
  searchParams: URLSearchParams | ReadonlyURLSearchParamsLike,
  inboundUserIds: readonly string[],
): string | null {
  const asParam = searchParams.get("as");
  if (!asParam) return null;
  if (!inboundUserIds.includes(asParam)) return null;
  writeContextCookie(asParam);
  return asParam;
}

// ReadonlyURLSearchParams (from next/navigation) is compatible with URLSearchParams
// on the get() method. This alias keeps us decoupled from the Next.js import.
interface ReadonlyURLSearchParamsLike {
  get(name: string): string | null;
}
