import { createHmac } from "node:crypto";
import { WebEnv } from "@vakwen/config/web";

const API_BASE = WebEnv.SERVER_API_BASE_URL ?? WebEnv.NEXT_PUBLIC_API_BASE_URL;

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export async function POST(request: Request) {
  try {
    // Forward incoming cookies to the API (e.g. existing session)
    const incomingCookie = request.headers.get("cookie") ?? "";

    const res = await fetch(`${API_BASE}/auth/demo/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(incomingCookie ? { cookie: incomingCookie } : {}),
      },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    if (!res.ok) {
      return Response.json(body, { status: res.status });
    }

    // Construct the signed session cookie on the web side.
    // Forwarding Set-Cookie from the upstream API through NextResponse is
    // unreliable — response.cookies.set() URL-encodes the value (demo: → demo%3A)
    // which can cause HMAC verification mismatches in the middleware, and
    // getSetCookie()/headers.append("Set-Cookie") may be stripped by Next.js.
    const secret = WebEnv.SESSION_SECRET;
    if (!secret) {
      return Response.json({ error: "missing_session_secret" }, { status: 500 });
    }

    const payload = `demo:${body.userId}`;
    const signedCookie = `${payload}.${hmacSign(payload, secret)}`;

    const cookieName = WebEnv.SESSION_COOKIE_NAME;
    const isProduction = process.env.NODE_ENV === "production";
    const secure = isProduction || cookieName.startsWith("__Host-");

    const maxAge = Math.max(
      0,
      Math.floor((new Date(body.expiresAt).getTime() - Date.now()) / 1000),
    );

    // __Host- prefix prohibits Domain attribute per RFC 6265bis.
    const cookieDomain =
      WebEnv.COOKIE_DOMAIN && !cookieName.startsWith("__Host-")
        ? `Domain=${WebEnv.COOKIE_DOMAIN}`
        : "";

    const setCookie = [
      `${cookieName}=${signedCookie}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
      ...(cookieDomain ? [cookieDomain] : []),
      `Max-Age=${maxAge}`,
    ].join("; ");

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setCookie,
      },
    });
  } catch {
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
}
