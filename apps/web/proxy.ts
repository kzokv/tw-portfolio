import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "__Host-g_auth_session";

/**
 * Protect all routes except /login when AUTH_MODE=oauth.
 * In dev_bypass mode (NEXT_PUBLIC_AUTH_MODE unset or not "oauth") the proxy
 * is transparent so existing dev/E2E flows are unaffected.
 */
export function proxy(request: NextRequest): NextResponse {
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== "oauth") {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon\\.ico).*)"],
};
