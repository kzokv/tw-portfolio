import type { APIRequestContext, Page } from "@playwright/test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WebAAABase } from "../src/core/WebAAABase.js";

describe("WebAAABase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses options.page when provided", () => {
    const page = { goto: vi.fn() } as unknown as Page;
    const request = {} as APIRequestContext;

    const base = new WebAAABase({
      instance: { page: {} } as never,
      request,
      page,
    });

    expect(base.page).toBe(page);
  });

  it("falls back to _instance.page when options.page is omitted", () => {
    const instancePage = { goto: vi.fn() } as unknown as Page;
    const request = {} as APIRequestContext;

    const base = new WebAAABase({
      instance: { page: instancePage } as never,
      request,
    });

    expect(base.page).toBe(instancePage);
  });

  it("throws a clear error when neither options.page nor _instance.page exists", () => {
    const request = {} as APIRequestContext;

    expect(() => {
      new WebAAABase({
        instance: {} as never,
        request,
      });
    }).toThrow(/page/i);
  });
});
