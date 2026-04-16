export function extractCookieValue(setCookieHeader: string, cookieName: string): string | null {
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  return match?.[1] ?? null;
}

export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ParsedSessionCookie {
  userId: string;
  hmac: string;
  isDemo: boolean;
  sessionVersion?: number;
}

export function parseSessionCookie(cookieValue: string): ParsedSessionCookie {
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot <= 0) {
    throw new Error(`Invalid session cookie format (no dot separator): ${cookieValue}`);
  }

  const payload = cookieValue.slice(0, lastDot);
  const hmac = cookieValue.slice(lastDot + 1);
  if (!payload || !hmac) {
    throw new Error(`Invalid session cookie format (empty payload or HMAC): ${cookieValue}`);
  }

  if (payload.startsWith("demo:")) {
    return {
      userId: payload.slice(5),
      hmac,
      isDemo: true,
    };
  }

  const sessionSeparator = payload.lastIndexOf(".");
  if (sessionSeparator > 0) {
    const userId = payload.slice(0, sessionSeparator);
    const sessionVersionRaw = payload.slice(sessionSeparator + 1);
    if (/^\d+$/.test(sessionVersionRaw)) {
      return {
        userId,
        hmac,
        isDemo: false,
        sessionVersion: Number(sessionVersionRaw),
      };
    }
  }

  return {
    userId: payload,
    hmac,
    isDemo: false,
  };
}
