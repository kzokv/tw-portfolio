import { parseDotEnvLine } from "../../libs/config/src/env-schema.js";

export { parseDotEnvLine };

/**
 * Parse an entire .env file content into a key→value map.
 * Blank lines and comments are skipped. Inline comments and quotes are stripped.
 */
export function parseDotEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (parsed) {
      map.set(parsed.key, parsed.value);
    }
  }
  return map;
}
