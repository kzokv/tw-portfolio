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
  enumOptions?: string[];
  fieldType?: "string" | "number" | "enum";
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
      field = (field as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
    }

    // Extract enum options and field type from the unwrapped inner type
    let enumOptions: string[] | undefined;
    let fieldType: "string" | "number" | "enum" = "string";

    if (field instanceof z.ZodEnum) {
      enumOptions = (field as z.ZodEnum<[string, ...string[]]>).options as string[];
      fieldType = "enum";
    } else if (field instanceof z.ZodNumber) {
      fieldType = "number";
    } else if (field instanceof z.ZodEffects && field._def.schema instanceof z.ZodNumber) {
      // z.coerce.number() wraps ZodNumber in ZodEffects
      fieldType = "number";
    }

    result.set(key, {
      defaultValue: hasDefault ? String(defaultValue) : undefined,
      optional,
      enumOptions,
      fieldType,
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

/**
 * Build a display hint for a key showing its current/default value and type info.
 * Format: "KEY = value  [type hint]"
 */
function formatKeyHint(
  key: string,
  info: SchemaKeyInfo,
  existingValue: string | undefined,
): string {
  const value = existingValue ?? info.defaultValue;
  let valueStr: string;
  if (sensitiveKeys.has(key) && existingValue !== undefined) {
    valueStr = "= ****";
  } else if (value !== undefined) {
    valueStr = `= ${value}`;
  } else {
    valueStr = "(not set)";
  }

  let typeHint: string;
  if (sensitiveKeys.has(key)) {
    typeHint = autoGenerateKeys.has(key) ? "[sensitive, auto-gen]" : "[sensitive]";
  } else if (info.enumOptions) {
    typeHint = `[${info.enumOptions.join(" | ")}]`;
  } else if (info.fieldType === "number") {
    typeHint = "[number]";
  } else if (info.optional && value === undefined) {
    typeHint = "[optional]";
  } else {
    typeHint = "";
  }

  const padded = key.padEnd(28);
  const valuePadded = valueStr.padEnd(36);
  return typeHint ? `  ${padded} ${valuePadded} ${typeHint}` : `  ${padded} ${valuePadded}`;
}

/** Prompt user to choose which keys to customize. */
export async function promptKeySelection(
  target: TargetConfig,
  schemaKeys: Map<string, SchemaKeyInfo>,
  existingValues?: Map<string, string>,
): Promise<string[]> {
  const { checkbox, Separator } = await loadPrompts();
  const existing = existingValues ?? new Map<string, string>();

  // Collect all keys in group order
  const orderedKeys: string[] = [];
  const allGroupKeys = new Set<string>();
  for (const group of target.groups) {
    for (const k of group.keys) {
      if (schemaKeys.has(k)) {
        orderedKeys.push(k);
        allGroupKeys.add(k);
      }
    }
  }
  const ungrouped = [...schemaKeys.keys()].filter((k) => !allGroupKeys.has(k));
  orderedKeys.push(...ungrouped);

  // Partition into new vs existing
  const newKeys = orderedKeys.filter((k) => !existing.has(k));
  const existingKeys = orderedKeys.filter((k) => existing.has(k));

  // Build choices with Separator dividers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const choices: any[] = [];

  if (newKeys.length > 0) {
    choices.push(new Separator(`── New keys (${newKeys.length}) ──`));
    for (const key of newKeys) {
      const info = schemaKeys.get(key)!;
      choices.push({ name: formatKeyHint(key, info, undefined), value: key });
    }
  }

  if (existingKeys.length > 0) {
    choices.push(new Separator(`── Existing keys (${existingKeys.length}) — select to override current value ──`));
    for (const key of existingKeys) {
      const info = schemaKeys.get(key)!;
      choices.push({ name: formatKeyHint(key, info, existing.get(key)), value: key });
    }
  }

  const selected = await checkbox({
    message: `Select keys to customize for ${target.label}: (space to toggle, enter to confirm)`,
    choices,
    loop: false,
    pageSize: getPageSize(),
  });

  return selected;
}

/**
 * Detect whether we're running inside a VM with Docker on a remote host.
 * Returns the Docker host IP if remote, or null if Docker is local.
 */
function detectDockerHostIp(): string | null {
  const dockerHost = process.env.DOCKER_HOST;
  if (!dockerHost) return null;
  try {
    const url = new URL(dockerHost);
    const ip = url.hostname;
    // If Docker host is a non-localhost IP, we're in a VM
    if (ip && ip !== "localhost" && ip !== "127.0.0.1") return ip;
  } catch { /* ignore */ }
  return null;
}

/**
 * Prompt for a host value with auto-detected options.
 * If running inside a VM, offers both localhost and the Docker host IP.
 */
async function promptHost(
  label: string,
  parsedHost?: string,
): Promise<string> {
  const { select, input } = await loadPrompts();
  const dockerHostIp = detectDockerHostIp();

  if (dockerHostIp) {
    // Inside a VM — offer choices
    const choices = [
      {
        name: `${dockerHostIp}  (Docker host — recommended for VM)`,
        value: dockerHostIp,
      },
      { name: "localhost", value: "localhost" },
      { name: "Custom...", value: "__custom__" },
    ];

    // If existing URL had a different host, add it as an option
    if (parsedHost && parsedHost !== dockerHostIp && parsedHost !== "localhost") {
      choices.splice(2, 0, { name: `${parsedHost}  (current)`, value: parsedHost });
    }

    const selected = await select({
      message: `  ${label} host:`,
      choices,
      default: parsedHost ?? dockerHostIp,
      loop: false,
    });

    if (selected === "__custom__") {
      return input({ message: `  ${label} host:`, default: parsedHost ?? dockerHostIp });
    }
    return selected;
  }

  // Not in a VM — simple input with localhost default
  return input({ message: `  ${label} host:`, default: parsedHost ?? "localhost" });
}

/**
 * Compose a URL by prompting for individual components.
 * Each component has a default; passwords use masked input.
 * Host auto-detects VM environment and offers Docker host IP.
 */
async function promptUrlComponents(
  key: "DB_URL" | "REDIS_URL",
  currentUrl?: string,
): Promise<string | undefined> {
  const { input, password: passwordPrompt } = await loadPrompts();

  // Parse existing URL into components (if available)
  let parsed: URL | null = null;
  if (currentUrl) {
    try {
      parsed = new URL(currentUrl);
    } catch { /* ignore malformed URLs */ }
  }

  if (key === "DB_URL") {
    console.log("  Compose DB_URL from components:\n");
    const host = await promptHost("DB", parsed?.hostname);
    const port = await input({ message: "  DB port:", default: parsed?.port ?? "5432" });
    const user = await input({ message: "  DB user:", default: decodeURIComponent(parsed?.username ?? "") || "vakwen" });
    const pw = await passwordPrompt({ message: "  DB password:" });
    if (!pw) return undefined;
    const dbName = await input({ message: "  DB name:", default: parsed?.pathname?.slice(1) ?? "vakwen" });
    const url = `postgres://${user}:${pw}@${host}:${port}/${dbName}`;
    console.log(`  → DB_URL composed (password masked)\n`);
    return url;
  }

  // REDIS_URL
  console.log("  Compose REDIS_URL from components:\n");
  const host = await promptHost("Redis", parsed?.hostname);
  const port = await input({ message: "  Redis port:", default: parsed?.port ?? "6379" });
  const pw = await passwordPrompt({ message: "  Redis password (empty for no auth):" });
  const auth = pw ? `:${pw}@` : "";
  const url = `redis://${auth}${host}:${port}`;
  console.log(`  → REDIS_URL composed${pw ? " (password masked)" : ""}\n`);
  return url;
}

/** Keys that use the component-prompt flow instead of raw string input. */
const composedUrlKeys = new Set(["DB_URL", "REDIS_URL"]);

/** Prompt for a single key's value, using select/password/confirm/input as appropriate. */
export async function promptKeyValue(
  key: string,
  defaultValue?: string,
  info?: SchemaKeyInfo,
): Promise<string | undefined> {
  const { confirm, password, input, select } = await loadPrompts();

  // Composed URL keys — prompt for components and build the URL
  if (composedUrlKeys.has(key)) {
    return promptUrlComponents(key as "DB_URL" | "REDIS_URL", defaultValue);
  }

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

  // Use dropdown select for enum fields
  if (info?.enumOptions) {
    const val = await select({
      message: `${key}:`,
      choices: info.enumOptions.map((opt) => ({
        name: opt === defaultValue ? `${opt}    (current)` : opt,
        value: opt,
      })),
      default: defaultValue,
      loop: false,
    });
    return val;
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
