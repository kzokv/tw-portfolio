/** Extract a named cookie value from a Set-Cookie header string. Returns null if not found. */
export function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  return match?.[1] ?? null;
}

/** UUID v4 pattern — strictly validates version 4 and variant 1 (RFC 4122). */
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Parse an HMAC-signed session cookie value into its components.
 * Cookie format: `<userId>.<hmac-signature>`
 */
export function parseSessionCookie(cookieValue: string): { userId: string; hmac: string } {
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot <= 0) {
    throw new Error(`Invalid session cookie format (no dot separator): ${cookieValue}`);
  }
  return {
    userId: cookieValue.slice(0, lastDot),
    hmac: cookieValue.slice(lastDot + 1),
  };
}
