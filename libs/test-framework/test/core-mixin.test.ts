import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoreMixin } from "../src/mixins/CoreMixin.js";

function createMockPage() {
  return {
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
}

class MockBase {
  page: ReturnType<typeof createMockPage>;
  constructor(page: ReturnType<typeof createMockPage>) {
    this.page = page;
  }
}

const MixedClass = CoreMixin(MockBase);

describe("CoreMixin", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("uses provided timeoutMs for load-state wait", async () => {
    const page = createMockPage();
    const instance = new MixedClass(page);

    await instance.mxWaitForShellClientReady(10_000);

    // Second call should use the provided timeout, not the default 5000
    expect(page.waitForLoadState).toHaveBeenCalledWith("load", { timeout: 10_000 });
  });

  it("falls back to default timeout when timeoutMs is not provided", async () => {
    const page = createMockPage();
    const instance = new MixedClass(page);

    await instance.mxWaitForShellClientReady();

    expect(page.waitForLoadState).toHaveBeenCalledWith("load", { timeout: 5_000 });
  });

  it("logs a warning when load-state wait times out", async () => {
    const page = createMockPage();
    page.waitForLoadState
      .mockResolvedValueOnce(undefined) // domcontentloaded succeeds
      .mockRejectedValueOnce(new Error("Timeout 5000ms exceeded")); // load fails

    const instance = new MixedClass(page);

    await instance.mxWaitForShellClientReady();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("load-state wait timed out");
  });

  it("does not warn when load-state completes normally", async () => {
    const page = createMockPage();
    const instance = new MixedClass(page);

    await instance.mxWaitForShellClientReady();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("mxWaitForAppReady delegates to mxWaitForShellClientReady with timeoutMs", async () => {
    const page = createMockPage();
    const instance = new MixedClass(page);

    await instance.mxWaitForAppReady(8_000);

    expect(page.waitForLoadState).toHaveBeenCalledWith("load", { timeout: 8_000 });
  });
});
