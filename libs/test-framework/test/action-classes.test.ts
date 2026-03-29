import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActionLogger } from "../src/logging/ActionLogger.js";
import { NormalClick } from "../src/actions/click.js";
import { NormalFill } from "../src/actions/fill.js";
import { NormalSelect } from "../src/actions/select.js";
import { WaitForVisible } from "../src/actions/wait.js";

function createMockLocator(description?: string) {
  const locator = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    waitFor: vi.fn().mockResolvedValue(undefined),
    description: description ? () => description : undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return locator as any;
}

describe("Action classes with ActionLogger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("NormalClick", () => {
    it("drains browser errors after successful click", async () => {
      const logger = new ActionLogger({ testName: "click test" });
      const click = new NormalClick(logger);
      const locator = createMockLocator("Button[submit]");

      logger.pushError("console error during click");
      await click.perform(locator);

      // Browser error should have been logged via console.error
      expect(errorSpy).toHaveBeenCalledOnce();
      const errorOutput = errorSpy.mock.calls[0]![0] as string;
      expect(errorOutput).toContain("[browser-error]");
      expect(errorOutput).toContain("console error during click");
    });

    it("drains browser errors even when click fails", async () => {
      const logger = new ActionLogger({ testName: "fail test" });
      const click = new NormalClick(logger);
      const locator = createMockLocator("Button[broken]");
      locator.click.mockRejectedValue(new Error("Element not found"));

      logger.pushError("error before failure");

      await expect(click.perform(locator)).rejects.toThrow("Element not found");
      expect(errorSpy).toHaveBeenCalledOnce();
      const errorOutput = errorSpy.mock.calls[0]![0] as string;
      expect(errorOutput).toContain("error before failure");
    });

    it("does nothing when no browser errors buffered", async () => {
      const logger = new ActionLogger({ testName: "clean test" });
      const click = new NormalClick(logger);
      const locator = createMockLocator("Button[ok]");

      await click.perform(locator);

      // info called for the action, but no error calls
      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("NormalFill", () => {
    it("drains browser errors after fill", async () => {
      const logger = new ActionLogger({ testName: "fill test" });
      const fill = new NormalFill(logger);
      const locator = createMockLocator("Input[email]");

      logger.pushError("validation error in browser");
      await fill.perform(locator, "test@example.com");

      expect(errorSpy).toHaveBeenCalledOnce();
      const errorOutput = errorSpy.mock.calls[0]![0] as string;
      expect(errorOutput).toContain("validation error in browser");
    });

    it("masks sensitive values in JSONL logs", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "fill-sensitive-"));
      const logPath = join(tmpDir, "actions.jsonl");
      const logger = new ActionLogger({ testName: "sensitive-fill", jsonlPath: logPath });
      const fill = new NormalFill(logger);
      const locator = createMockLocator("Input[password]");

      await fill.perform(locator, "s3cret-p@ssw0rd!", { sensitive: true });

      const line = readFileSync(logPath, "utf-8").trim();
      const entry = JSON.parse(line);
      expect(entry.action).toContain("********");
      expect(entry.action).not.toContain("s3cret-p@ssw0rd!");

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not mask non-sensitive values in JSONL logs", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "fill-normal-"));
      const logPath = join(tmpDir, "actions.jsonl");
      const logger = new ActionLogger({ testName: "normal-fill", jsonlPath: logPath });
      const fill = new NormalFill(logger);
      const locator = createMockLocator("Input[email]");

      await fill.perform(locator, "user@test.com");

      const line = readFileSync(logPath, "utf-8").trim();
      const entry = JSON.parse(line);
      expect(entry.action).toContain("user@test.com");

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("NormalSelect", () => {
    it("drains browser errors after select", async () => {
      const logger = new ActionLogger({ testName: "select test" });
      const select = new NormalSelect(logger);
      const locator = createMockLocator("Select[country]");

      logger.pushError("select error");
      await select.perform(locator, "US");

      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  describe("WaitForVisible", () => {
    it("drains browser errors after wait", async () => {
      const logger = new ActionLogger({ testName: "wait test" });
      const wait = new WaitForVisible(logger);
      const locator = createMockLocator("Dialog[confirm]");

      logger.pushError("runtime error during wait");
      await wait.perform(locator);

      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });
});
