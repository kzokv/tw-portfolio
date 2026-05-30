import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaders.get(name) ?? null,
  })),
}));
vi.mock("../../../components/layout/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock">theme toggle</div>,
}));

import AuthErrorPage from "../../../app/auth/error/page";

describe("AuthErrorPage", () => {
  beforeEach(() => {
    mockHeaders.clear();
  });

  it("renders invalid_state message", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "invalid_state" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("invalid or expired");
    expect(html).toContain('data-testid="auth-error-try-again"');
    expect(html).toContain("ERR · invalid_state");
  });

  it("renders oauth_error message", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "oauth_error" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Sign-in cancelled");
    expect(html).toContain("Google reported an error");
    expect(html).toContain('data-testid="auth-error-try-again"');
  });

  it("renders server_error message", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "server_error" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("server error");
    expect(html).toContain('data-testid="auth-error-try-again"');
  });

  it("renders default message for unknown reason", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "totally_unknown" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("unexpected error");
    expect(html).toContain('data-testid="auth-error-try-again"');
  });

  it("renders default message when reason is missing", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("unexpected error");
    expect(html).toContain('data-testid="auth-error-try-again"');
  });

  it("renders invite-specific message", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "invite_required" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Invite required");
    expect(html).toContain("needs a valid invite");
  });

  it("renders localized copy from Accept-Language", async () => {
    mockHeaders.set("accept-language", "zh-TW,zh;q=0.9");
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "expired_code" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("邀請已過期");
    expect(html).toContain("回到登入頁");
  });

  it("try-again link points to /login", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "oauth_error" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/login"');
  });
});
