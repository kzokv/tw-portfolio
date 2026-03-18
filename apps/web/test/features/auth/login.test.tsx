import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoginPage from "../../../app/login/page";

describe("login page", () => {
  it("renders sign in with Google text", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain("Sign in with Google");
  });

  it("sign-in button links to Google OAuth start endpoint", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain("/auth/google/start");
  });

  it("sign-in button has correct data-testid", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain('data-testid="google-sign-in-button"');
  });
});
