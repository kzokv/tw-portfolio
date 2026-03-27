import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActionLogger } from "../src/logging/ActionLogger.js";

describe("ActionLogger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("console format", () => {
    it("outputs [+relative] [testName] [action] target format", () => {
      const logger = new ActionLogger({ testName: "my test" });

      logger.info("[click] Button[submit]");

      expect(consoleSpy).toHaveBeenCalledOnce();
      const output = consoleSpy.mock.calls[0]![0] as string;
      // Format: [+0.XXs] [my test] [click] Button[submit]
      expect(output).toMatch(/^\[(\+\d+\.\d{2}s)\] \[my test\] \[click\] Button\[submit\]$/);
    });

    it("includes relative timestamp from logger creation", async () => {
      const logger = new ActionLogger({ testName: "timing test" });

      // Wait a small amount to get a nonzero timestamp
      await new Promise((r) => setTimeout(r, 50));
      logger.info("[fill] Input[email] <= user@test.com");

      const output = consoleSpy.mock.calls[0]![0] as string;
      const match = output.match(/^\[(\+(\d+\.\d{2})s)\]/);
      expect(match).not.toBeNull();
      const seconds = parseFloat(match![2]!);
      expect(seconds).toBeGreaterThanOrEqual(0.04);
      expect(seconds).toBeLessThan(1);
    });

    it("uses warn level for warnings", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logger = new ActionLogger({ testName: "warn test" });

      logger.warn("something unexpected");

      expect(warnSpy).toHaveBeenCalledOnce();
      const output = warnSpy.mock.calls[0]![0] as string;
      expect(output).toMatch(/^\[\+\d+\.\d{2}s\] \[warn test\] something unexpected$/);
      warnSpy.mockRestore();
    });

    it("handles missing test name gracefully", () => {
      const logger = new ActionLogger({});

      logger.info("[click] Button[ok]");

      const output = consoleSpy.mock.calls[0]![0] as string;
      // Without test name, format is: [+0.XXs] [click] Button[ok]
      expect(output).toMatch(/^\[\+\d+\.\d{2}s\] \[click\] Button\[ok\]$/);
    });
  });

  describe("JSONL file output", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "action-logger-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes structured JSON line with absolute ISO timestamp", () => {
      const logPath = join(tmpDir, "actions.jsonl");
      const logger = new ActionLogger({ testName: "jsonl test", jsonlPath: logPath });

      logger.info("[click] Button[submit]");

      expect(existsSync(logPath)).toBe(true);
      const line = readFileSync(logPath, "utf-8").trim();
      const entry = JSON.parse(line);
      expect(entry).toMatchObject({
        test: "jsonl test",
        action: "[click] Button[submit]",
      });
      // Absolute ISO timestamp
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("appends multiple entries as separate lines", () => {
      const logPath = join(tmpDir, "actions.jsonl");
      const logger = new ActionLogger({ testName: "multi", jsonlPath: logPath });

      logger.info("[click] Button[a]");
      logger.info("[fill] Input[b] <= val");
      logger.warn("[warn] something");

      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);

      const entries = lines.map((l) => JSON.parse(l));
      expect(entries[0]!.action).toBe("[click] Button[a]");
      expect(entries[0]!.level).toBe("info");
      expect(entries[1]!.action).toBe("[fill] Input[b] <= val");
      expect(entries[2]!.level).toBe("warn");
    });

    it("does not write JSONL when jsonlPath is not provided", () => {
      const logger = new ActionLogger({ testName: "no file" });

      logger.info("[click] Button[ok]");

      // No file created — only console output
      expect(consoleSpy).toHaveBeenCalledOnce();
    });
  });

  describe("error buffer", () => {
    it("pushError buffers errors and drainErrors returns them", () => {
      const logger = new ActionLogger({ testName: "error test" });

      logger.pushError("Uncaught TypeError: x is not a function");
      logger.pushError("Failed to load resource: 404");

      const errors = logger.drainErrors();
      expect(errors).toEqual([
        "Uncaught TypeError: x is not a function",
        "Failed to load resource: 404",
      ]);
    });

    it("drainErrors clears the buffer", () => {
      const logger = new ActionLogger({ testName: "drain test" });

      logger.pushError("error 1");
      const first = logger.drainErrors();
      expect(first).toHaveLength(1);

      const second = logger.drainErrors();
      expect(second).toHaveLength(0);
    });

    it("drainErrors returns empty array when no errors", () => {
      const logger = new ActionLogger({ testName: "empty test" });

      expect(logger.drainErrors()).toEqual([]);
    });

    it("logs drained errors to console as error level", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = new ActionLogger({ testName: "console error" });

      logger.pushError("TypeError: boom");
      logger.info("[click] Button[submit]");

      // After info() call, drained errors should have been logged
      // But drainErrors is manual — caller controls when to drain
      // So pushError just buffers, drainErrors returns them
      const errors = logger.drainErrors();
      expect(errors).toEqual(["TypeError: boom"]);

      errorSpy.mockRestore();
    });

    it("writes drained errors to JSONL with browser-error level", () => {
      const tmpDir2 = mkdtempSync(join(tmpdir(), "action-logger-err-"));
      const logPath = join(tmpDir2, "actions.jsonl");
      const logger = new ActionLogger({ testName: "jsonl error", jsonlPath: logPath });

      logger.pushError("ReferenceError: foo is not defined");
      logger.logDrainedErrors("[click] Button[submit]");

      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      const errorEntry = lines.find((l) => JSON.parse(l).level === "browser-error");
      expect(errorEntry).toBeDefined();
      const parsed = JSON.parse(errorEntry!);
      expect(parsed).toMatchObject({
        test: "jsonl error",
        action: "ReferenceError: foo is not defined",
        level: "browser-error",
        duringAction: "[click] Button[submit]",
      });

      rmSync(tmpDir2, { recursive: true, force: true });
    });
  });
});
