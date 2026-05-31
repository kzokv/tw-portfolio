import fs from "node:fs";
import path from "node:path";
import { parseDotEnvFile } from "./parser.js";
import type { TargetConfig } from "./types.js";

/**
 * Given a source root path, find and parse the env file that corresponds to the target.
 * For root:local, also checks <source>/.env as a backward-compat fallback (pre-rename).
 */
export function readSourceValues(
  target: TargetConfig,
  sourcePath: string,
): Map<string, string> {
  const candidates: string[] = [path.join(sourcePath, target.targetPath)];

  // Backward-compat: root:local previously used .env
  if (target.id === "root:local") {
    candidates.push(path.join(sourcePath, ".env"));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, "utf8");
      return parseDotEnvFile(content);
    }
  }

  return new Map();
}
