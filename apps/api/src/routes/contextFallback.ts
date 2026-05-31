/**
 * Constants and helpers for the portfolio-switcher context fallback signal
 * (KZO-146). Extracted into a standalone module so streaming routes (e.g.
 * sseRoute.ts) can read the request-level flag without creating an import
 * cycle through registerRoutes.ts.
 *
 * The signal fires when the client sent an `x-context-user-id` header that
 * the auth middleware could not validate (malformed, self-share, revoked, or
 * no active share). The onSend hook in app.ts stamps the response with
 * `x-context-fallback: revoked` and a clear-cookie directive so the client
 * can tear down UI state. Streaming routes that bypass `reply.send()` must
 * propagate these headers manually (see sseRoute.ts).
 */

import type { FastifyRequest } from "fastify";

export const CONTEXT_COOKIE_NAME = "tw_context_user_id";
export const CONTEXT_FALLBACK_HEADER = "x-context-fallback";
export const CONTEXT_HEADER_NAME = "x-context-user-id";

export function markContextFallback(req: FastifyRequest): void {
  req.__contextFallback = true;
}

export function shouldStampContextFallback(req: FastifyRequest): boolean {
  return req.__contextFallback === true;
}

/**
 * The Set-Cookie string that clears the context cookie. Path=/ + SameSite=Lax
 * match the client-side `writeContextCookie` attrs (no HttpOnly; no Domain;
 * no Secure in dev). Using a non-matching clear directive silently fails.
 */
export function contextClearCookieString(): string {
  return `${CONTEXT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
