import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that depend on them
// ---------------------------------------------------------------------------

const mockHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaders.get(name) ?? null,
  })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // Make cache transparent so each test gets a fresh call
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  };
});

// Mutable WebEnv mock — tests can override per-case
const mockWebEnv = {
  NEXT_PUBLIC_AUTH_MODE: "oauth" as "oauth" | "dev_bypass",
  SESSION_COOKIE_NAME: "__Host-g_auth_session",
  SESSION_SECRET: "test-session-secret-that-is-long-enough-32chars!!",
};

vi.mock("@tw-portfolio/config/web", () => ({
  get WebEnv() {
    return mockWebEnv;
  },
}));

// Now import the modules under test — they will pick up our mocks
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, requireSession } from "../../../lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-session-secret-that-is-long-enough-32chars!!";
const SESSION_COOKIE = "__Host-g_auth_session";

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function signCookie(userId: string, secret: string = SECRET): string {
  return `${userId}.${hmacSign(userId, secret)}`;
}

function makeCookieStore(pairs: Record<string, string>) {
  return {
    get: (name: string) =>
      pairs[name] !== undefined ? { name, value: pairs[name] } : undefined,
  };
}

function setCookie(value: string) {
  vi.mocked(cookies).mockResolvedValue(
    makeCookieStore({ [SESSION_COOKIE]: value }) as Awaited<
      ReturnType<typeof cookies>
    >,
  );
}

function setNoCookie() {
  vi.mocked(cookies).mockResolvedValue(
    makeCookieStore({}) as Awaited<ReturnType<typeof cookies>>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks();
  mockHeaders.clear();
  // Reset to oauth defaults
  mockWebEnv.NEXT_PUBLIC_AUTH_MODE = "oauth";
  mockWebEnv.SESSION_SECRET = SECRET;
});

// ---- oauth mode -----------------------------------------------------------

describe("getSession (oauth mode)", () => {
  it("returns null when session cookie is absent", async () => {
    setNoCookie();
    expect(await getSession()).toBeNull();
  });

  it("returns null when session cookie value is empty string", async () => {
    setCookie("");
    expect(await getSession()).toBeNull();
  });

  it("returns null when session cookie value is whitespace only", async () => {
    setCookie("   ");
    expect(await getSession()).toBeNull();
  });

  it("returns { userId } for a validly-signed cookie", async () => {
    setCookie(signCookie("google-sub-123"));
    expect(await getSession()).toEqual({ userId: "google-sub-123" });
  });

  it("returns null for a tampered HMAC", async () => {
    const tampered =
      "google-sub-123.badhmacsignaturebadhmacsignaturebadhmacsignaturebadhmacsignature";
    setCookie(tampered);
    expect(await getSession()).toBeNull();
  });

  it("returns null for a plain userId with no HMAC", async () => {
    setCookie("google-sub-123");
    expect(await getSession()).toBeNull();
  });

  it("returns null when signed with a different secret", async () => {
    setCookie(signCookie("google-sub-123", "other-secret-that-is-long-enough-32chars!!"));
    expect(await getSession()).toBeNull();
  });

  it("returns null for malformed input (no dot separator)", async () => {
    setCookie("no-dot-here");
    expect(await getSession()).toBeNull();
  });

  it("returns null when HMAC portion is empty (trailing dot)", async () => {
    setCookie("sub.");
    expect(await getSession()).toBeNull();
  });

  it("returns null when userId portion is empty (leading dot)", async () => {
    setCookie(".somehmacsig");
    expect(await getSession()).toBeNull();
  });

  it("correctly handles a userId that contains dots", async () => {
    const userId = "numeric.sub.with.dots";
    setCookie(signCookie(userId));
    expect(await getSession()).toEqual({ userId });
  });

  it("logs a warning on HMAC mismatch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setCookie(
      "google-sub-123.badhmacsignaturebadhmacsignaturebadhmacsignaturebadhmacsignature",
    );
    await getSession();
    expect(warnSpy).toHaveBeenCalledWith(
      "[auth] HMAC verification failed for session cookie",
    );
    warnSpy.mockRestore();
  });

  it("returns null and logs warning when SESSION_SECRET is not configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWebEnv.SESSION_SECRET = undefined as unknown as string;
    setCookie(signCookie("google-sub-123"));
    expect(await getSession()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[auth] SESSION_SECRET is not configured but AUTH_MODE is oauth",
    );
    warnSpy.mockRestore();
  });
});

// ---- dev_bypass mode ------------------------------------------------------

describe("getSession (dev_bypass mode)", () => {
  beforeEach(() => {
    mockWebEnv.NEXT_PUBLIC_AUTH_MODE = "dev_bypass";
  });

  it("returns { userId } from plain cookie value without HMAC check", async () => {
    setCookie("user-1");
    expect(await getSession()).toEqual({ userId: "user-1" });
  });

  it("trims whitespace from the cookie value", async () => {
    setCookie("  user-1  ");
    expect(await getSession()).toEqual({ userId: "user-1" });
  });

  it("returns null when session cookie is absent", async () => {
    setNoCookie();
    expect(await getSession()).toBeNull();
  });

  it("returns null when session cookie value is empty", async () => {
    setCookie("");
    expect(await getSession()).toBeNull();
  });

  it("does not require SESSION_SECRET", async () => {
    mockWebEnv.SESSION_SECRET = undefined as unknown as string;
    setCookie("user-1");
    expect(await getSession()).toEqual({ userId: "user-1" });
  });

  it("falls back to tw_e2e_user cookie when session cookie is absent", async () => {
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore({ tw_e2e_user: "qa-user-1" }) as Awaited<ReturnType<typeof cookies>>,
    );
    expect(await getSession()).toEqual({ userId: "qa-user-1" });
  });

  it("decodes URL-encoded tw_e2e_user cookie value", async () => {
    vi.mocked(cookies).mockResolvedValue(
      makeCookieStore({ tw_e2e_user: encodeURIComponent("qa-user-1") }) as Awaited<ReturnType<typeof cookies>>,
    );
    expect(await getSession()).toEqual({ userId: "qa-user-1" });
  });
});

// ---- requireSession -------------------------------------------------------

describe("requireSession", () => {
  it("returns session when authenticated", async () => {
    setCookie(signCookie("google-sub-123"));
    const session = await requireSession();
    expect(session).toEqual({ userId: "google-sub-123" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when not authenticated", async () => {
    setNoCookie();
    await requireSession();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when cookie is invalid", async () => {
    setCookie("tampered-value");
    await requireSession();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login?returnTo when x-current-path is set and not authenticated", async () => {
    setNoCookie();
    mockHeaders.set("x-current-path", "/transactions");
    await requireSession();
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Ftransactions");
  });

  it("does not include returnTo for /login path", async () => {
    setNoCookie();
    mockHeaders.set("x-current-path", "/login");
    await requireSession();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
