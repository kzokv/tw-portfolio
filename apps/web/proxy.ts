import { WebEnv } from "@tw-portfolio/config/web";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  // In dev_bypass mode, skip session enforcement so standard E2E tests and
  // local development work without needing a real session cookie.
  if (WebEnv.NEXT_PUBLIC_AUTH_MODE !== "oauth") {
    return NextResponse.next();
  }

  const session = request.cookies.get(WebEnv.SESSION_COOKIE_NAME);
  if (!session?.value?.trim()) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect all paths except: /login, /auth/error, /_next/*, static assets
    "/((?!login|auth/error|_next/|favicon\\.ico|robots\\.txt|manifest\\.json|.*\\..*).*)",
  ],
};
