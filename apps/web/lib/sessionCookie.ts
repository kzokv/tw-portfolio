export interface DemoSessionCookie {
  userId: string;
  isDemo: true;
  hmac: string;
  signedPayload: string;
}

export interface OauthSessionCookie {
  userId: string;
  isDemo: false;
  sessionVersion: number;
  hmac: string;
  signedPayload: string;
}

export type ParsedSessionCookie = DemoSessionCookie | OauthSessionCookie;

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.parseInt(value, 10) > 0;
}

export function parseSessionCookie(cookieValue: string): ParsedSessionCookie | null {
  const trimmed = cookieValue.trim();
  if (!trimmed) return null;

  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = trimmed.slice(0, lastDot);
  const hmac = trimmed.slice(lastDot + 1);
  if (!payload || !hmac) return null;

  if (payload.startsWith("demo:")) {
    if (payload.includes(".", "demo:".length)) return null;

    const userId = payload.slice("demo:".length);
    if (!userId) return null;

    return {
      userId,
      isDemo: true,
      hmac,
      signedPayload: payload,
    };
  }

  const sessionSeparator = payload.lastIndexOf(".");
  if (sessionSeparator <= 0) return null;

  const userId = payload.slice(0, sessionSeparator);
  const sessionVersionRaw = payload.slice(sessionSeparator + 1);
  if (!userId || userId.startsWith("demo:") || !isPositiveInteger(sessionVersionRaw)) return null;

  return {
    userId,
    isDemo: false,
    sessionVersion: Number.parseInt(sessionVersionRaw, 10),
    hmac,
    signedPayload: payload,
  };
}
