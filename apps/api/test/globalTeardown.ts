import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

/**
 * Vitest global teardown — runs once in the main process after all workers exit.
 *
 * Kills any orphaned Fastify processes that were started by port:0 integration
 * tests and failed to close in afterEach (e.g., due to test timeout or crash).
 *
 * Worker-thread Fastify servers are normally released when the worker exits.
 * This acts as a safety net for edge cases where the process survives.
 */
export default function globalTeardown(): void {
  if (process.platform === "win32") return;

  const apiSrcPath = path.join(repoRoot, "apps", "api", "src");
  try {
    execSync(`pkill -f "${apiSrcPath}" 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // pkill exits non-zero when no processes matched — expected in clean runs.
  }
}
