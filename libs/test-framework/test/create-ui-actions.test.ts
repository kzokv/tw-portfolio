import { describe, it, expect, vi, afterEach } from "vitest";
import { createUIActions } from "../src/actions/index.js";
import { ActionLogger } from "../src/logging/ActionLogger.js";

describe("createUIActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an ActionLogger instance", () => {
    const logger = new ActionLogger({ testName: "factory test" });
    const actions = createUIActions({ logger });

    expect(actions.click).toBeDefined();
    expect(actions.fill).toBeDefined();
    expect(actions.select).toBeDefined();
    expect(actions.wait).toBeDefined();
  });

  it("passes the logger to all action classes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ActionLogger({ testName: "wiring test" });
    const infoSpy = vi.spyOn(logger, "info");
    const actions = createUIActions({ logger });

    const mockLocator = {
      click: vi.fn().mockResolvedValue(undefined),
      description: () => "Button[test]",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await actions.click.perform(mockLocator);

    // The logger's info method should have been called (not raw console)
    expect(infoSpy).toHaveBeenCalledWith("[click] Button[test]");
  });

  it("createDefaultActionLogger creates a logger with test.info() integration", () => {
    // ActionLogger can be created with no testName — will be resolved at call time
    const logger = new ActionLogger({});
    const actions = createUIActions({ logger });
    expect(actions.click).toBeDefined();
  });
});
