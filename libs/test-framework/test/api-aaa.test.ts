import type { APIRequestContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiAssistantRegistry } from "../src/config/mapper.js";
import { ApiAAABase, BaseEndpoint, TestUser } from "../src/core/index.js";

class ExampleEndpoint extends BaseEndpoint {}

class ExampleApiActor extends ApiAAABase<ExampleEndpoint> {}

describe("API AAA framework", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestUser.reset()", () => {
    it("clears assistantCache so useApiAssistant returns fresh instance after reset", async () => {
      const factory = vi.fn((options: { instance: ExampleEndpoint }) => ({
        endpoint: options.instance,
      }));
      apiAssistantRegistry.register(ExampleEndpoint, factory);

      const request = {
        post: vi.fn().mockResolvedValue({ ok: () => true }),
      } as unknown as APIRequestContext;
      const testUser = new TestUser({ request, userId: "user-reset" });

      const first = await testUser.useApiAssistant<ExampleEndpoint, { endpoint: ExampleEndpoint }>(
        ExampleEndpoint,
      );
      expect(factory).toHaveBeenCalledTimes(1);

      await testUser.reset("http://localhost:4000");

      const second = await testUser.useApiAssistant<ExampleEndpoint, { endpoint: ExampleEndpoint }>(
        ExampleEndpoint,
      );
      expect(factory).toHaveBeenCalledTimes(2);
      expect(second).not.toBe(first);
    });

    it("clears notes after reset", async () => {
      const request = {
        post: vi.fn().mockResolvedValue({ ok: () => true }),
      } as unknown as APIRequestContext;
      const testUser = new TestUser({ request, userId: "user-notes" });

      testUser.appendNote("symbols", ["AAPL", "GOOG"]);
      expect(testUser.getNote("symbols")).toEqual(["AAPL", "GOOG"]);

      await testUser.reset("http://localhost:4000");

      expect(testUser.getNote("symbols")).toBeUndefined();
    });

    it("clears sessionCookie after reset", async () => {
      const request = {
        post: vi.fn().mockResolvedValue({ ok: () => true }),
      } as unknown as APIRequestContext;
      const testUser = new TestUser({ request, userId: "user-cookie" });

      testUser.setSessionCookie("session=abc123");
      expect(testUser.sessionCookie).toBe("session=abc123");

      await testUser.reset("http://localhost:4000");

      expect(testUser.sessionCookie).toBeUndefined();
    });
  });

  it("creates and caches API assistants via TestUser.useApiAssistant", async () => {
    const factory = vi.fn((options: { instance: ExampleEndpoint }) => ({
      endpoint: options.instance,
    }));
    apiAssistantRegistry.register(ExampleEndpoint, factory);

    const request = {} as APIRequestContext;
    const testUser = new TestUser({
      request,
      userId: "user-123",
    });

    const first = await testUser.useApiAssistant<ExampleEndpoint, { endpoint: ExampleEndpoint }>(
      ExampleEndpoint,
    );
    const second = await testUser.useApiAssistant<ExampleEndpoint, { endpoint: ExampleEndpoint }>(
      ExampleEndpoint,
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.endpoint).toBeInstanceOf(ExampleEndpoint);
    expect(second).toBe(first);
  });

  it("prefers a session cookie over x-user-id in API auth headers", () => {
    const request = {} as APIRequestContext;
    const testUser = new TestUser({
      request,
      userId: "user-123",
    });
    testUser.setSessionCookie("session=value");

    const actor = new ExampleApiActor({
      instance: new ExampleEndpoint(request),
      request,
      testUser,
      userId: testUser.userId,
    });

    expect(actor.authHeaders).toEqual({ cookie: "session=value" });
  });

  it("warns when both sessionCookie and userId are set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = {} as APIRequestContext;
    const testUser = new TestUser({
      request,
      userId: "user-123",
    });
    testUser.setSessionCookie("session=value");

    const actor = new ExampleApiActor({
      instance: new ExampleEndpoint(request),
      request,
      testUser,
      userId: testUser.userId,
    });

    const headers = actor.authHeaders;

    expect(headers).toEqual({ cookie: "session=value" });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("sessionCookie");
    warnSpy.mockRestore();
  });

  it("falls back to x-user-id when no API session cookie exists", () => {
    const request = {} as APIRequestContext;
    const testUser = new TestUser({
      request,
      userId: "user-123",
    });

    const actor = new ExampleApiActor({
      instance: new ExampleEndpoint(request),
      request,
      testUser,
      userId: testUser.userId,
    });

    expect(actor.authHeaders).toEqual({ "x-user-id": "user-123" });
  });
});
