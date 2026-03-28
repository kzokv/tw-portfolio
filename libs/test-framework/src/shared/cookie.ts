export function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  return match?.[1] ?? null;
}

export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
