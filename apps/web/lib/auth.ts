import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { cache } from "react";

import { WebEnv } from "@tw-portfolio/config/web";
import { cookies, headers } from "next/headers";
import { parseSessionCookie } from "./sessionCookie";

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

export interface Session {
  userId: string;
  isDemo: boolean;
  sessionVersion?: number;
}

// ---------------------------------------------------------------------------
// HMAC helpers (duplicated from API — small, stable, avoids cross-app import)
// ---------------------------------------------------------------------------

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function hmacVerify(
  data: string,
  receivedHmac: string,
  secret: string,
): boolean {
  const expectedHmac = hmacSign(data, secret);
  try {
    const expectedBuf = Buffer.from(expectedHmac, "hex");
    const receivedBuf = Buffer.from(receivedHmac, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core resolver (request-deduped via React.cache)
// ---------------------------------------------------------------------------

const resolveSession = cache(async (): Promise<Session | null> => {
  // dev_bypass: short-circuit, skip HMAC
  if (WebEnv.NEXT_PUBLIC_AUTH_MODE === "dev_bypass") {
    const cookieStore = await cookies();
    const raw = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
    if (raw?.trim()) return { userId: raw.trim(), isDemo: false };
    // SESSION_COOKIE_NAME uses the __Host- prefix which requires HTTPS,
    // so local/E2E environments set tw_e2e_user instead.
    const e2eRaw = cookieStore.get("tw_e2e_user")?.value;
    if (e2eRaw?.trim()) return { userId: decodeURIComponent(e2eRaw.trim()), isDemo: false };
    return { userId: "user-1", isDemo: false };  // matches API's resolveUserId() fallback
  }

  // oauth mode: HMAC verification required
  const secret = WebEnv.SESSION_SECRET;
  if (!secret) {
    // During Docker build (static generation), SESSION_SECRET is unavailable —
    // it's a runtime-only secret, not a build arg. Silence the warning.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      console.warn(
        "[auth] SESSION_SECRET is not configured but AUTH_MODE is oauth",
      );
    }
    return null;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
  if (!raw?.trim()) return null;

  const parsed = parseSessionCookie(raw);
  if (!parsed) return null;

  if (!hmacVerify(parsed.signedPayload, parsed.hmac, secret)) {
    console.warn("[auth] HMAC verification failed for session cookie");
    return null;
  }

  if (parsed.isDemo) {
    return { userId: parsed.userId, isDemo: true };
  }

  return {
    userId: parsed.userId,
    isDemo: false,
    sessionVersion: parsed.sessionVersion,
  };
});

export function isValidReturnTo(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try {
    const url = new URL(path, "http://n");
    return url.host === "n";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current session or null.
 * Safe to call from Server Components and Route Handlers.
 * Result is request-deduped via React.cache().
 */
export async function getSession(): Promise<Session | null> {
  return resolveSession();
}

/**
 * Returns the current session or redirects to /login.
 * Use in protected Server Components and Route Handlers.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const headerStore = await headers();
    const pathname = headerStore.get("x-current-path");
    if (pathname && isValidReturnTo(pathname) && pathname !== "/login") {
      redirect(`/login?returnTo=${encodeURIComponent(pathname)}`);
    }
    redirect("/login");
  }
  return session;
}
