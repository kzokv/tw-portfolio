/**
 * Pure helpers for Next.js middleware (proxy.ts) header composition.
 *
 * Extracted for unit testing — the middleware itself depends on `next/server`
 * which is not resolvable in the vitest jsdom environment.
 */

import { CONTEXT_USER_ID_COOKIE } from "./context";

/** Minimal structural shape of `NextRequest.cookies` (and Next route-handler cookies). */
interface RequestCookiesLike {
  get(name: string): { value: string } | undefined;
}

/**
 * Translate the portfolio-switcher context cookie into the
 * `x-context-user-id` request header that the API backend validates.
 *
 * Mutates `headers` in place:
 *   - Sets the header to the trimmed cookie value when present and non-empty.
 *   - Deletes any incoming `x-context-user-id` header otherwise (anti-spoof:
 *     clients can never bypass the cookie by forging the header).
 *
 * The backend re-validates the value against `portfolio_shares` — this layer
 * only plumbs; it does not authorize.
 */
export function applyContextForwarding(
  headers: Headers,
  request: { cookies: RequestCookiesLike },
): void {
  const cookieValue = request.cookies.get(CONTEXT_USER_ID_COOKIE)?.value?.trim();
  if (cookieValue && cookieValue.length > 0) {
    headers.set("x-context-user-id", cookieValue);
  } else {
    headers.delete("x-context-user-id");
  }
}
