import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  CONTEXT_USER_ID_COOKIE,
} from "../../lib/context";
import { getJson, postJson } from "../../lib/api";

describe("apps/web/lib/api — context header injection + fallback intercept", () => {
  beforeEach(() => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0`;
  });

  afterEach(() => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0`;
    vi.restoreAllMocks();
  });

  it("injects x-context-user-id header on getJson when context cookie is set", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJson("/api/ping");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-context-user-id"]).toBe("owner-42");
  });

  it("omits x-context-user-id header when context cookie is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJson("/api/ping");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-context-user-id"]).toBeUndefined();
  });

  it("injects x-context-user-id header on postJson when context cookie is set", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-7")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await postJson("/api/trades", { symbol: "AAPL" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-context-user-id"]).toBe("owner-7");
  });

  it("clears context cookie and dispatches tw:context-fallback-revoked on getJson when response has x-context-fallback: revoked", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-context-fallback": "revoked",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const listener = vi.fn();
    window.addEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);

    await getJson("/api/ping");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(document.cookie).not.toContain(`${CONTEXT_USER_ID_COOKIE}=owner-42`);

    window.removeEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);
  });

  it("does not clear cookie when response has no x-context-fallback header", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const listener = vi.fn();
    window.addEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);

    await getJson("/api/ping");

    expect(listener).not.toHaveBeenCalled();
    expect(document.cookie).toContain(`${CONTEXT_USER_ID_COOKIE}=owner-42`);

    window.removeEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);
  });

  it("does not throw when fallback intercepts — the response body is still returned", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "payload" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-context-fallback": "revoked",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getJson<{ data: string }>("/api/ping");
    expect(result).toEqual({ data: "payload" });
  });

  it("clears context cookie on postJson when response has x-context-fallback: revoked", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-context-fallback": "revoked",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const listener = vi.fn();
    window.addEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);

    await postJson("/api/trades", { symbol: "AAPL" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(document.cookie).not.toContain(`${CONTEXT_USER_ID_COOKIE}=owner-42`);

    window.removeEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, listener as EventListener);
  });

  it("clears context cookie when 401 triggers logout redirect (getJson)", async () => {
    // Arrange — session-expired 401 with no fallback header (classic logout flow).
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Stub window.location.href setter so the redirect doesn't throw in jsdom.
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new Proxy({ href: "" }, {
        set(target, prop, value) {
          if (prop === "href") hrefSetter(value);
          (target as Record<string | symbol, unknown>)[prop] = value;
          return true;
        },
      }),
    });

    // Act — redirectToLogoutOn401 returns a Promise that never resolves, so we
    // fire-and-forget and wait for microtasks to flush.
    void getJson("/api/ping").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assert
    expect(document.cookie).not.toContain(`${CONTEXT_USER_ID_COOKIE}=owner-42`);
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });
});
