import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// lib/auth (imported by login/page) calls React.cache() at module level.
// Make cache a no-op passthrough so it works in the Vitest Node.js context.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn };
});
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@tw-portfolio/config/web", () => ({
  WebEnv: { NEXT_PUBLIC_AUTH_MODE: "dev_bypass", SESSION_COOKIE_NAME: "__Host-g_auth_session" },
}));
vi.mock("../../../components/SignInButton", () => ({
  SignInButton: function MockSignInButton(props: Record<string, unknown>) {
    const R = (globalThis as Record<string, unknown>).React as typeof import("react");
    return R.createElement("a", {
      href: props.href,
      className: props.className,
      "data-testid": "google-sign-in-button",
    }, "Sign in with Google");
  },
}));

import LoginPage from "../../../app/login/page";

describe("login page", () => {
  it("renders sign in with Google text", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Sign in with Google");
  });

  it("sign-in button links to Google OAuth start endpoint", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("/auth/google/start");
  });

  it("sign-in button has correct data-testid", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-testid="google-sign-in-button"');
  });

  it("threads returnTo to sign-in button href", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ returnTo: "/transactions" }) }));
    expect(html).toContain("returnTo");
    expect(html).toContain("%2Ftransactions");
  });

  it("rejects absolute URL returnTo", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ returnTo: "https://evil.com" }) }));
    expect(html).not.toContain("evil.com");
    expect(html).not.toContain("returnTo");
  });
});
