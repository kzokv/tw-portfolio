import type { TargetConfig, ResolvedValue } from "./types.js";

/**
 * Characters that require shell quoting when emitted into a `.env` file that
 * may be sourced via `set -a; source <file>` (the canonical Docker / shell
 * pattern). The list mirrors POSIX shell metacharacters plus quote characters.
 *
 * The ASCII space character is the load-bearing trigger for KZO-198 cron
 * strings (`"30 17 * * 1-5"`); the rest are defensive against any future env
 * value containing shell-special characters.
 */
const SHELL_SPECIAL_RE = /[\s*?[\]();|&<>\\`$'"\n]/;

/**
 * Quote an env-file value if it contains any shell-special character.
 * Wrap in double quotes and escape `"`, `$`, `` ` ``, and `\` per POSIX
 * double-quote rules (these four are the only chars that retain special
 * meaning inside `"..."` and require backslash escaping).
 *
 * Empty strings, plain alphanumerics, and values that already start AND end
 * with a quote pair are passed through unchanged.
 */
export function shellQuoteEnvValue(value: string): string {
  if (value.length === 0) return value;
  // Pass-through if already quoted (idempotent — generator may re-emit a
  // pre-quoted default from .env.example without doubling the quotes).
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value;
  }
  if (!SHELL_SPECIAL_RE.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
  return `"${escaped}"`;
}

/**
 * Generate .env file content from a list of resolved values, using group metadata
 * to produce section headers and ordered output.
 */
export function generateFileContent(
  target: TargetConfig,
  values: Map<string, ResolvedValue>,
): string {
  const lines: string[] = [];
  const emitted = new Set<string>();

  for (const group of target.groups) {
    // Only emit section if at least one key in the group is in our value map
    const groupKeys = group.keys.filter((k) => values.has(k));
    if (groupKeys.length === 0) continue;

    lines.push(`## ${group.label}`);
    for (const key of groupKeys) {
      const rv = values.get(key)!;
      if (rv.value !== undefined) {
        lines.push(`${key}=${shellQuoteEnvValue(rv.value)}`);
      } else {
        lines.push(`#${key}=`);
      }
      emitted.add(key);
    }
    lines.push("");
  }

  // Safety-net "Other" section for any ungrouped keys
  const ungrouped = [...values.keys()].filter((k) => !emitted.has(k));
  if (ungrouped.length > 0) {
    lines.push("## Other");
    for (const key of ungrouped) {
      const rv = values.get(key)!;
      if (rv.value !== undefined) {
        lines.push(`${key}=${shellQuoteEnvValue(rv.value)}`);
      } else {
        lines.push(`#${key}=`);
      }
    }
    lines.push("");
  }

  // Footer notes (compose-computed derivation hints, etc.)
  if (target.footerNotes?.length) {
    for (const note of target.footerNotes) {
      lines.push(`## ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
