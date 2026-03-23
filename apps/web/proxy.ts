import { createHmac, timingSafeEqual } from "node:crypto";
import { WebEnv } from "@tw-portfolio/config/web";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// HMAC helpers (duplicated from API — small, stable, avoids cross-app import)
function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function hmacVerify(data: string, receivedHmac: string, secret: string): boolean {
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

function verifySessionCookie(cookieValue: string, secret: string): boolean {
  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex <= 0) return false;
  const userId = cookieValue.slice(0, dotIndex);
  const receivedHmac = cookieValue.slice(dotIndex + 1);
  if (!userId || !receivedHmac) return false;
  return hmacVerify(userId, receivedHmac, secret);
}

export function proxy(request: NextRequest): NextResponse {
  // In dev_bypass mode, skip session enforcement
  if (WebEnv.NEXT_PUBLIC_AUTH_MODE !== "oauth") {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const session = request.cookies.get(WebEnv.SESSION_COOKIE_NAME);
  const cookieValue = session?.value?.trim();

  if (!cookieValue) {
    // No cookie → redirect to login with returnTo
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie present — verify HMAC
  const secret = WebEnv.SESSION_SECRET;
  if (secret) {
    if (!verifySessionCookie(cookieValue, secret)) {
      // Cookie present but HMAC invalid → session expired
      const errorUrl = request.nextUrl.clone();
      errorUrl.pathname = "/auth/error";
      errorUrl.searchParams.set("reason", "session_expired");
      return NextResponse.redirect(errorUrl);
    }
  } else {
    console.warn("[proxy] SESSION_SECRET is not configured but AUTH_MODE is oauth — HMAC verification skipped");
  }

  // Valid session — pass through with x-current-path header for requireSession()
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-current-path", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Protect all paths except: /login, /auth/error, /api/demo/*, /_next/*, static assets
    "/((?!login|auth/error|api/demo|_next/|favicon\\.ico|robots\\.txt|manifest\\.json|.*\\..*).*)",
  ],
};
