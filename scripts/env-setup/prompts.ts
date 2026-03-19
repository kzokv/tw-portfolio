import crypto from "node:crypto";
/** Dynamic page size: terminal height minus chrome rows, with a safe minimum. */
function getPageSize(): number {
  return Math.max(10, (process.stdout.rows ?? 24) - 4);
}

/** Lazily load @inquirer/prompts — only needed in interactive mode. */
async function loadPrompts() {
  try {
    return await import("@inquirer/prompts");
  } catch {
    throw new Error(
      "Missing @inquirer/prompts — run `npm install` first.\n" +
        "This dependency is only required for interactive mode.",
    );
  }
}

import { z } from "zod";
import { sensitiveKeys, autoGenerateKeys } from "../../libs/config/src/env-metadata.js";
import type { TargetConfig, TargetId } from "./types.js";
import { targets } from "./targets.js";

export interface SchemaKeyInfo {
  defaultValue?: string;
  optional: boolean;
}

/**
 * Introspect a ZodObject schema to extract key names and their default values.
 * Unwraps ZodDefault and ZodOptional wrappers.
 */
export function getSchemaKeysAndDefaults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>,
): Map<string, SchemaKeyInfo> {
  const result = new Map<string, SchemaKeyInfo>();

  for (const [key, rawField] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    let field: z.ZodTypeAny = rawField;
    let hasDefault = false;
    let defaultValue: unknown;
    let optional = false;

    if (field instanceof z.ZodDefault) {
      hasDefault = true;
      defaultValue = (field as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue();
      field = (field as z.ZodDefault<z.ZodTypeAny>)._def.innerType;
    }

    if (field instanceof z.ZodOptional) {
      optional = true;
    }

    result.set(key, {
      defaultValue: hasDefault ? String(defaultValue) : undefined,
      optional,
    });
  }

  return result;
}

/** Prompt user to select which targets to process. */
export async function promptTargetSelection(): Promise<TargetId[]> {
  const { checkbox } = await loadPrompts();
  const choices = [
    { name: "All targets", value: "all" as const },
    ...targets.map((t) => ({ name: t.label, value: t.id })),
  ];

  const selected = await checkbox({
    message: "Select env targets to configure:",
    choices,
    loop: false,
    pageSize: getPageSize(),
  });

  if (selected.includes("all")) {
    return targets.map((t) => t.id);
  }

  return selected as TargetId[];
}

/** Prompt user to choose a merge strategy for an existing file. */
export async function promptMergeStrategy(targetPath: string): Promise<"sync" | "override"> {
  const { select } = await loadPrompts();
  return select({
    message: `${targetPath} already exists. Choose merge strategy:`,
    choices: [
      { name: "Sync to example (keep existing, prompt for new keys only)", value: "sync" as const },
      { name: "Override from example (start fresh with defaults)", value: "override" as const },
    ],
    loop: false,
  });
}

/** Prompt user to choose which keys to customize. */
export async function promptKeySelection(
  target: TargetConfig,
  schemaKeys: Map<string, SchemaKeyInfo>,
): Promise<string[]> {
  const { checkbox } = await loadPrompts();
  const choices: Array<{ name: string; value: string; disabled?: string }> = [];

  // Group keys by section for display
  const grouped: Array<{ section: string; keys: string[] }> = [];
  const allGroupKeys = new Set<string>();

  for (const group of target.groups) {
    const keys = group.keys.filter((k) => schemaKeys.has(k));
    if (keys.length > 0) {
      grouped.push({ section: group.label, keys });
      keys.forEach((k) => allGroupKeys.add(k));
    }
  }

  // Add ungrouped keys
  const ungrouped = [...schemaKeys.keys()].filter((k) => !allGroupKeys.has(k));
  if (ungrouped.length > 0) {
    grouped.push({ section: "Other", keys: ungrouped });
  }

  for (const { section, keys } of grouped) {
    choices.push({ name: `── ${section} ──`, value: `__section_${section}`, disabled: "" });
    for (const key of keys) {
      const info = schemaKeys.get(key)!;
      const hint = sensitiveKeys.has(key)
        ? "[sensitive]"
        : info.defaultValue !== undefined
          ? `default: ${info.defaultValue}`
          : info.optional
            ? "[optional]"
            : "[required]";
      choices.push({ name: `  ${key}  (${hint})`, value: key });
    }
  }

  const selected = await checkbox({
    message: `Select keys to customize for ${target.label}:`,
    choices: choices.filter((c) => !c.disabled && !c.value.startsWith("__section_")).map((c) => ({
      name: c.name,
      value: c.value,
    })),
    loop: false,
    pageSize: getPageSize(),
  });

  return selected;
}

/** Prompt for a single key's value, using password/confirm/input as appropriate. */
export async function promptKeyValue(key: string, defaultValue?: string): Promise<string | undefined> {
  const { confirm, password, input } = await loadPrompts();
  if (autoGenerateKeys.has(key)) {
    const autoGen = await confirm({
      message: `Auto-generate ${key}?`,
      default: true,
    });
    if (autoGen) {
      return crypto.randomBytes(32).toString("hex");
    }
  }

  if (sensitiveKeys.has(key)) {
    const val = await password({ message: `${key}:` });
    return val || undefined;
  }

  const val = await input({
    message: `${key}:`,
    default: defaultValue,
  });
  return val || undefined;
}

/** Print a grouped summary table of key/value pairs, masking sensitive values. */
export function showSummaryTable(
  target: TargetConfig,
  schemaKeys: Map<string, SchemaKeyInfo>,
  existingValues?: Map<string, string>,
): void {
  console.log(`\n  ${target.label} — key summary:\n`);

  const allGroupKeys = new Set<string>();
  const grouped: Array<{ section: string; keys: string[] }> = [];

  for (const group of target.groups) {
    const keys = group.keys.filter((k) => schemaKeys.has(k));
    if (keys.length > 0) {
      grouped.push({ section: group.label, keys });
      keys.forEach((k) => allGroupKeys.add(k));
    }
  }

  const ungrouped = [...schemaKeys.keys()].filter((k) => !allGroupKeys.has(k));
  if (ungrouped.length > 0) {
    grouped.push({ section: "Other", keys: ungrouped });
  }

  for (const { section, keys } of grouped) {
    console.log(`  [${section}]`);
    for (const key of keys) {
      const info = schemaKeys.get(key)!;
      let displayValue: string;

      const existing = existingValues?.get(key);
      if (existing !== undefined) {
        displayValue = sensitiveKeys.has(key) ? "***" : existing;
      } else if (info.defaultValue !== undefined) {
        displayValue = sensitiveKeys.has(key) ? "***" : info.defaultValue;
      } else if (info.optional) {
        displayValue = "(unset)";
      } else {
        displayValue = "(required — no default)";
      }

      console.log(`    ${key.padEnd(36)} ${displayValue}`);
    }
    console.log("");
  }
}
