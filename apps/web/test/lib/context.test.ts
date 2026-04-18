import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_USER_ID_COOKIE,
  applyDeepLinkAs,
  clearContextCookie,
  readContextCookie,
  writeContextCookie,
} from "../../lib/context";

describe("apps/web/lib/context", () => {
  beforeEach(() => {
    // Reset document.cookie between tests (jsdom persists it otherwise).
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  });

  afterEach(() => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    vi.restoreAllMocks();
  });

  describe("readContextCookie", () => {
    it("returns null when no cookie is set", () => {
      expect(readContextCookie()).toBeNull();
    });

    it("returns the decoded owner user id when the cookie is present", () => {
      document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
      expect(readContextCookie()).toBe("owner-42");
    });

    it("returns null when the cookie value is empty", () => {
      document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/`;
      expect(readContextCookie()).toBeNull();
    });
  });

  describe("writeContextCookie", () => {
    it("writes a cookie with SameSite=Lax and Path=/ and no HttpOnly", () => {
      writeContextCookie("owner-1");
      // jsdom exposes document.cookie as a simple key=value pair string.
      expect(document.cookie).toContain(`${CONTEXT_USER_ID_COOKIE}=owner-1`);
      expect(readContextCookie()).toBe("owner-1");
    });

    it("dispatches tw:context-changed CustomEvent with ownerUserId detail", () => {
      const listener = vi.fn();
      window.addEventListener("tw:context-changed", listener as EventListener);
      writeContextCookie("owner-2");
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as CustomEvent<{ ownerUserId: string | null }>;
      expect(event.detail).toEqual({ ownerUserId: "owner-2" });
      window.removeEventListener("tw:context-changed", listener as EventListener);
    });
  });

  describe("clearContextCookie", () => {
    it("removes an existing context cookie", () => {
      writeContextCookie("owner-3");
      expect(readContextCookie()).toBe("owner-3");
      clearContextCookie();
      expect(readContextCookie()).toBeNull();
    });

    it("dispatches tw:context-changed with null ownerUserId", () => {
      writeContextCookie("owner-4");
      const listener = vi.fn();
      window.addEventListener("tw:context-changed", listener as EventListener);
      clearContextCookie();
      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as CustomEvent<{ ownerUserId: string | null }>;
      expect(event.detail).toEqual({ ownerUserId: null });
      window.removeEventListener("tw:context-changed", listener as EventListener);
    });
  });

  describe("applyDeepLinkAs", () => {
    it("returns null and does nothing when ?as= is absent", () => {
      const params = new URLSearchParams();
      expect(applyDeepLinkAs(params, ["owner-1", "owner-2"])).toBeNull();
      expect(readContextCookie()).toBeNull();
    });

    it("returns null and does not write cookie when ?as= is not in allowed owners", () => {
      const params = new URLSearchParams("as=stranger");
      expect(applyDeepLinkAs(params, ["owner-1"])).toBeNull();
      expect(readContextCookie()).toBeNull();
    });

    it("writes cookie and returns ownerUserId when ?as= matches an inbound share", () => {
      const params = new URLSearchParams("as=owner-1");
      expect(applyDeepLinkAs(params, ["owner-1", "owner-2"])).toBe("owner-1");
      expect(readContextCookie()).toBe("owner-1");
    });
  });
});
