import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthErrorPage from "../../../app/auth/error/page";

describe("AuthErrorPage", () => {
  it("renders invalid_state message", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "invalid_state" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Sign-in failed");
    expect(html).toContain("invalid or expired");
    expect(html).toContain('data-testid="auth-error-try-again"');
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

  it("try-again link points to /login", async () => {
    const element = await AuthErrorPage({ searchParams: Promise.resolve({ reason: "oauth_error" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/login"');
  });
});
