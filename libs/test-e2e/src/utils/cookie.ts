/** Extract a named cookie value from a Set-Cookie header string. Returns null if not found. */
export function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  return match?.[1] ?? null;
}
