import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { createAnonymousShareTokenPurgeHandler } from "../../src/services/registerAnonymousShareTokenPurgeWorker.js";

function makeJob(): JobWithMetadata<Record<string, never>> {
  return {
    data: {},
    retryCount: 0,
    retryLimit: 3,
  } as JobWithMetadata<Record<string, never>>;
}

describe("createAnonymousShareTokenPurgeHandler", () => {
  it("invokes purgeTerminalAnonymousShareTokens with injected cutoffMs and logs success", async () => {
    // Arrange
    const persistence = {
      purgeTerminalAnonymousShareTokens: vi.fn().mockResolvedValue(7),
    };
    const log = { info: vi.fn(), error: vi.fn() };
    const cutoffMs = 123_456;

    const handler = createAnonymousShareTokenPurgeHandler({
      persistence,
      cutoffMs,
      log,
    } as never);

    // Act
    await handler([makeJob()]);

    // Assert — persistence called with the injected cutoffMs
    expect(persistence.purgeTerminalAnonymousShareTokens).toHaveBeenCalledWith(cutoffMs);
    expect(persistence.purgeTerminalAnonymousShareTokens).toHaveBeenCalledTimes(1);

    // Assert — success log with correct shape
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: 7, cutoffMs }),
      "anonymous_share_token_purge_completed",
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs failure and rethrows on persistence error", async () => {
    // Arrange
    const boom = new Error("boom");
    const persistence = {
      purgeTerminalAnonymousShareTokens: vi.fn().mockRejectedValue(boom),
    };
    const log = { info: vi.fn(), error: vi.fn() };
    const cutoffMs = 1;

    const handler = createAnonymousShareTokenPurgeHandler({
      persistence,
      cutoffMs,
      log,
    } as never);

    // Act + Assert — rethrows so pg-boss can retry
    await expect(handler([makeJob()])).rejects.toThrow(boom);

    // Assert — error log with cutoffMs in payload
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ cutoffMs }),
      "anonymous_share_token_purge_failed",
    );
    expect(log.info).not.toHaveBeenCalled();
  });
});
