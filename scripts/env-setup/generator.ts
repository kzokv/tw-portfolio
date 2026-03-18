import type { TargetConfig, ResolvedValue } from "./types.js";

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
        lines.push(`${key}=${rv.value}`);
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
        lines.push(`${key}=${rv.value}`);
      } else {
        lines.push(`#${key}=`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
