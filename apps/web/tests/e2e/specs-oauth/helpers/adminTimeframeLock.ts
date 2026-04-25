import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { TestEnv } from "@tw-portfolio/config/test";

const LOCK_DIR = path.join(
  tmpdir(),
  `tw-portfolio-${TestEnv.ports.api}-admin-timeframe.lock`,
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Serializes specs that mutate/read the global admin dashboard timeframe
 * config while the OAuth E2E suite runs with multiple workers.
 *
 * The memory-backed API has one app_config row shared by every browser user,
 * so admin-timeframe specs and dashboard-timeframe specs can otherwise race
 * each other. Directory creation is atomic across worker processes on the
 * local filesystem, making it enough for this test-only lock.
 */
export async function acquireAdminTimeframeLock(): Promise<() => Promise<void>> {
  const deadline = Date.now() + 55_000;
  while (true) {
    try {
      await mkdir(LOCK_DIR);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for admin timeframe lock: ${LOCK_DIR}`);
      }
      await delay(100);
    }
  }
}
