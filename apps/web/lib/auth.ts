import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { cache } from "react";

import { WebEnv } from "@tw-portfolio/config/web";
import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

export interface Session {
  userId: string;
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
    if (!raw?.trim()) return null;
    return { userId: raw.trim() };
  }

  // oauth mode: HMAC verification required
  const secret = WebEnv.SESSION_SECRET;
  if (!secret) {
    console.warn(
      "[auth] SESSION_SECRET is not configured but AUTH_MODE is oauth",
    );
    return null;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
  if (!raw?.trim()) return null;

  const cookieValue = raw.trim();
  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  const userId = cookieValue.slice(0, dotIndex);
  const receivedHmac = cookieValue.slice(dotIndex + 1);
  if (!userId || !receivedHmac) return null;

  if (!hmacVerify(userId, receivedHmac, secret)) {
    console.warn("[auth] HMAC verification failed for session cookie");
    return null;
  }

  return { userId };
});

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
    redirect("/login");
  }
  return session;
}
