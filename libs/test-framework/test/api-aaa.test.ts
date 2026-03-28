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
