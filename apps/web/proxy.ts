import { WebEnv } from "@vakwen/config/web";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applyContextForwarding } from "./lib/proxyHeaders";
import { parseSessionCookie } from "./lib/sessionCookie";

const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return bytesToHex(new Uint8Array(signature));
}

async function verifySessionCookie(cookieValue: string, secret: string): Promise<boolean> {
  const parsed = parseSessionCookie(cookieValue);
  if (!parsed) return false;

  const expectedHmac = await hmacSign(parsed.signedPayload, secret);
  return constantTimeEqual(expectedHmac, parsed.hmac);
}

function isPublicPath(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/auth/error"
    || pathname === "/invite"
    || pathname.startsWith("/invite/")
    || pathname === "/api/demo"
    || pathname.startsWith("/api/demo/");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // In dev_bypass mode, skip session enforcement — but still forward the
  // portfolio-switcher context header so shared-context SSR works in E2E.
  if (WebEnv.NEXT_PUBLIC_AUTH_MODE !== "oauth") {
    const requestHeaders = new Headers(request.headers);
    applyContextForwarding(requestHeaders, request);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const pathname = request.nextUrl.pathname;
  const currentPath = `${pathname}${request.nextUrl.search}`;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(WebEnv.SESSION_COOKIE_NAME);
  const cookieValue = session?.value?.trim();

  if (!cookieValue) {
    // No cookie → redirect to login with returnTo
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("returnTo", currentPath);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie present — verify HMAC
  const secret = WebEnv.SESSION_SECRET;
  if (secret) {
    if (!(await verifySessionCookie(cookieValue, secret))) {
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
  requestHeaders.set("x-current-path", currentPath);
  applyContextForwarding(requestHeaders, request);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Protect all paths except: /login, /invite/*, /auth/error, /api/demo/*, /_next/*, static assets
    "/((?!login|invite(?:/|$)|auth/error|api/demo|_next/|favicon\\.ico|robots\\.txt|manifest\\.json|.*\\..*).*)",
  ],
};
