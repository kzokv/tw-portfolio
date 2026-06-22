import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  CONTEXT_USER_ID_COOKIE,
} from "../../lib/context";
import {
  getJson,
  patchJson,
  postJson,
  shouldInvalidatePortfolioRouteCaches,
} from "../../lib/api";
import { LOCALE_OVERRIDE_COOKIE } from "../../lib/i18n/localeOverrideCookie";

describe("apps/web/lib/api — context header injection + fallback intercept", () => {
  beforeEach(() => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0`;
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=; Path=/; Max-Age=0`;
  });

  afterEach(() => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=; Path=/; Max-Age=0`;
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=; Path=/; Max-Age=0`;
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


  it("suppresses x-context-user-id when a session-scoped request is requested", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-42")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJson("/profile", { contextScope: "session" });

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

  it("starts keepalive patch fetch synchronously with client auth headers", async () => {
    document.cookie = `${CONTEXT_USER_ID_COOKIE}=${encodeURIComponent("owner-fast-reload")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ locale: "en" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = patchJson("/settings", { locale: "en" }, { keepalive: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe(JSON.stringify({ locale: "en" }));
    expect((init.headers as Record<string, string>)["x-context-user-id"]).toBe(
      "owner-fast-reload",
    );

    await expect(request).resolves.toEqual({ locale: "en" });
  });

  it("applies the temporary locale override cookie to settings reads", async () => {
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=${encodeURIComponent("zh-TW")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        userId: "user-1",
        displayName: null,
        locale: "en",
        costBasisMethod: "WEIGHTED_AVERAGE",
        quotePollIntervalSeconds: 10,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getJson<{ locale: string }>("/settings");

    expect(result.locale).toBe("zh-TW");
  });

  it("ignores the locale override cookie for non-settings reads", async () => {
    document.cookie = `${LOCALE_OVERRIDE_COOKIE}=${encodeURIComponent("zh-TW")}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ locale: "en" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getJson<{ locale: string }>("/profile");

    expect(result.locale).toBe("en");
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

  it("invalidates portfolio route caches for delegated portfolio write routes only", () => {
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/portfolio/transactions")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("PATCH", "/portfolio/transactions/trade-1")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("DELETE", "/portfolio/transactions/trade-1")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/ai/transactions/confirm")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/ai/transaction-drafts/batch-1/confirm")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/accounts")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/accounts/account-1/purge")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/portfolio/refresh-closes")).toBe(true);
    expect(shouldInvalidatePortfolioRouteCaches("PUT", "/settings/fee-config")).toBe(true);

    expect(shouldInvalidatePortfolioRouteCaches("POST", "/portfolio/recompute/confirm")).toBe(false);
    expect(shouldInvalidatePortfolioRouteCaches("POST", "/share-tokens")).toBe(false);
  });
});
