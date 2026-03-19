import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@tw-portfolio/config/web", () => ({
  WebEnv: { SESSION_COOKIE_NAME: "__Host-g_auth_session" },
}));

import { cookies } from "next/headers";
import { getSession } from "../../../lib/auth";

function makeCookieStore(pairs: Record<string, string>) {
  return {
    get: (name: string) =>
      pairs[name] !== undefined ? { name, value: pairs[name] } : undefined,
  };
}

const SESSION_COOKIE = "__Host-g_auth_session";

afterEach(() => {
  vi.clearAllMocks();
});

describe("getSession", () => {
  it("returns null when session cookie is absent", async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({}) as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toBeNull();
  });

  it("returns null when session cookie value is empty string", async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({ [SESSION_COOKIE]: "" }) as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toBeNull();
  });

  it("returns null when session cookie value is whitespace only", async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({ [SESSION_COOKIE]: "   " }) as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toBeNull();
  });

  it("returns { userId } when session cookie has a valid value", async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({ [SESSION_COOKIE]: "google-sub-123" }) as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toEqual({ userId: "google-sub-123" });
  });

  it("trims whitespace from the cookie value", async () => {
    vi.mocked(cookies).mockResolvedValue(makeCookieStore({ [SESSION_COOKIE]: "  google-sub-456  " }) as Awaited<ReturnType<typeof cookies>>);
    expect(await getSession()).toEqual({ userId: "google-sub-456" });
  });

});
