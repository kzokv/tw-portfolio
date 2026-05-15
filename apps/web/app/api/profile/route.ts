import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "../../../lib/auth";
import { WebEnv } from "@vakwen/config/web";

// In Docker, server-side route handlers fetch via container network (SERVER_API_BASE_URL),
// not the host-published port. Falls back to NEXT_PUBLIC_API_BASE_URL for bare-metal dev.
const API_BASE = WebEnv.SERVER_API_BASE_URL ?? WebEnv.NEXT_PUBLIC_API_BASE_URL;

async function buildSessionCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  const value = cookieStore.get(WebEnv.SESSION_COOKIE_NAME)?.value;
  return value ? `${WebEnv.SESSION_COOKIE_NAME}=${value}` : "";
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  try {
    const cookieHeader = await buildSessionCookieHeader();
    const res = await fetch(`${API_BASE}/profile`, {
      headers: { cookie: cookieHeader },
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  try {
    const cookieHeader = await buildSessionCookieHeader();
    const body = await req.json();
    const res = await fetch(`${API_BASE}/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader,
      },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
