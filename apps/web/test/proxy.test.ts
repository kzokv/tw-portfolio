import { describe, expect, it } from "vitest";
import { applyContextForwarding } from "../lib/proxyHeaders";

function makeCookieStore(
  entries: Record<string, string>,
): { get(name: string): { value: string } | undefined } {
  return {
    get(name: string) {
      return name in entries ? { value: entries[name] } : undefined;
    },
  };
}

describe("apps/web/lib/proxyHeaders.applyContextForwarding", () => {
  it("sets x-context-user-id when tw_context_user_id cookie is present", () => {
    const headers = new Headers();
    applyContextForwarding(headers, {
      cookies: makeCookieStore({ tw_context_user_id: "owner-42" }),
    });
    expect(headers.get("x-context-user-id")).toBe("owner-42");
  });

  it("leaves x-context-user-id unset when cookie is absent", () => {
    const headers = new Headers();
    applyContextForwarding(headers, { cookies: makeCookieStore({}) });
    expect(headers.get("x-context-user-id")).toBeNull();
  });

  it("leaves x-context-user-id unset when cookie value is empty", () => {
    const headers = new Headers();
    applyContextForwarding(headers, {
      cookies: makeCookieStore({ tw_context_user_id: "" }),
    });
    expect(headers.get("x-context-user-id")).toBeNull();
  });

  it("trims whitespace from the cookie value before forwarding", () => {
    const headers = new Headers();
    applyContextForwarding(headers, {
      cookies: makeCookieStore({ tw_context_user_id: "  owner-42  " }),
    });
    expect(headers.get("x-context-user-id")).toBe("owner-42");
  });

  it("overwrites any pre-existing x-context-user-id header from the incoming request", () => {
    const headers = new Headers({ "x-context-user-id": "spoofed" });
    applyContextForwarding(headers, {
      cookies: makeCookieStore({ tw_context_user_id: "owner-42" }),
    });
    expect(headers.get("x-context-user-id")).toBe("owner-42");
  });

  it("removes any pre-existing x-context-user-id header when the cookie is absent (anti-spoof)", () => {
    const headers = new Headers({ "x-context-user-id": "spoofed" });
    applyContextForwarding(headers, { cookies: makeCookieStore({}) });
    expect(headers.get("x-context-user-id")).toBeNull();
  });
});
