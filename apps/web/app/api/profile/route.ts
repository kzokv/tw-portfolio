import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || `http://localhost:${process.env.NEXT_PUBLIC_API_PORT || process.env.API_PORT || 4000}`;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      headers: { "x-authenticated-user-id": session.userId },
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
    const body = await req.json();
    const res = await fetch(`${API_BASE}/profile`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": session.userId,
      },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
