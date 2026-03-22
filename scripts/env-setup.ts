#!/usr/bin/env tsx
/**
 * Interactive env file generator.
 *
 * Usage:
 *   npm run env:setup
 *   npm run env:setup -- --target root:local
 *   npm run env:setup -- --target root:local,docker:local --non-interactive
 *   npm run env:setup -- --target root:local,docker:local --non-interactive --source .
 */

import fs from "node:fs";
import path from "node:path";
import { targets } from "./env-setup/targets.js";
import { generateFileContent } from "./env-setup/generator.js";
import { readSourceValues } from "./env-setup/source-reader.js";
import { parseDotEnvFile } from "./env-setup/parser.js";
import {
  getSchemaKeysAndDefaults,
  promptTargetSelection,
  promptMergeStrategy,
  promptKeySelection,
  promptKeyValue,
  showSummaryTable,
} from "./env-setup/prompts.js";
import type { TargetConfig, TargetId, ResolvedValue } from "./env-setup/types.js";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  targetIds: TargetId[] | null; // null = prompt
  nonInteractive: boolean;
  sourcePath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts: CliOptions = { targetIds: null, nonInteractive: false, sourcePath: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--non-interactive") {
      opts.nonInteractive = true;
    } else if (arg === "--target" && args[i + 1]) {
      opts.targetIds = args[++i].split(",") as TargetId[];
    } else if (arg === "--source" && args[i + 1]) {
      opts.sourcePath = args[++i];
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Non-interactive value resolution
// ---------------------------------------------------------------------------

function resolveNonInteractive(
  target: TargetConfig,
  sourceValues: Map<string, string>,
  existingValues: Map<string, string>,
): Map<string, ResolvedValue> {
  const schemaKeys = getSchemaKeysAndDefaults(target.schema);
  const resolved = new Map<string, ResolvedValue>();

  for (const [key, info] of schemaKeys) {
    if (sourceValues.has(key)) {
      resolved.set(key, { key, value: sourceValues.get(key), source: "source-file" });
    } else if (existingValues.has(key)) {
      resolved.set(key, { key, value: existingValues.get(key), source: "existing" });
    } else if (info.defaultValue !== undefined) {
      resolved.set(key, { key, value: info.defaultValue, source: "default" });
    } else {
      resolved.set(key, { key, value: undefined, source: "default" });
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Interactive value resolution
// ---------------------------------------------------------------------------

async function resolveInteractive(
  target: TargetConfig,
  existingValues: Map<string, string>,
  strategy: "sync" | "override" | "fresh",
): Promise<Map<string, ResolvedValue>> {
  const schemaKeys = getSchemaKeysAndDefaults(target.schema);
  const resolved = new Map<string, ResolvedValue>();

  // Pre-populate with existing or defaults
  for (const [key, info] of schemaKeys) {
    if (strategy === "sync" && existingValues.has(key)) {
      resolved.set(key, { key, value: existingValues.get(key), source: "existing" });
    } else if (info.defaultValue !== undefined) {
      resolved.set(key, { key, value: info.defaultValue, source: "default" });
    } else {
      resolved.set(key, { key, value: undefined, source: "default" });
    }
  }

  showSummaryTable(target, schemaKeys, existingValues.size > 0 ? existingValues : undefined);

  // Determine which keys to prompt for
  let keysToPrompt: string[];
  if (strategy === "sync") {
    // Only prompt for keys missing from existing file
    keysToPrompt = [...schemaKeys.keys()].filter((k) => !existingValues.has(k));
    if (keysToPrompt.length === 0) {
      console.log("  All keys are already present in the existing file.\n");
    } else {
      console.log(`  ${keysToPrompt.length} new key(s) found. You can customize them:\n`);
      keysToPrompt = await promptKeySelection(target, schemaKeys);
    }
  } else {
    keysToPrompt = await promptKeySelection(target, schemaKeys);
  }

  // Prompt for each selected key
  for (const key of keysToPrompt) {
    const info = schemaKeys.get(key)!;
    const currentDefault = resolved.get(key)?.value ?? info.defaultValue;
    const value = await promptKeyValue(key, currentDefault);
    resolved.set(key, {
      key,
      value,
      source: value !== undefined && value !== currentDefault ? "user" : "default",
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Process a single target
// ---------------------------------------------------------------------------

async function processTarget(target: TargetConfig, options: CliOptions): Promise<void> {
  const fileExists = fs.existsSync(target.targetPath);

  // Read source values (from --source flag)
  const sourceValues = options.sourcePath
    ? readSourceValues(target, options.sourcePath)
    : new Map<string, string>();

  // Read existing file values
  const existingValues: Map<string, string> = fileExists
    ? parseDotEnvFile(fs.readFileSync(target.targetPath, "utf8"))
    : new Map();

  let resolved: Map<string, ResolvedValue>;

  if (options.nonInteractive) {
    resolved = resolveNonInteractive(target, sourceValues, existingValues);
  } else {
    let strategy: "sync" | "override" | "fresh";

    if (fileExists) {
      strategy = await promptMergeStrategy(target.targetPath);
    } else {
      strategy = "fresh";
    }

    resolved = await resolveInteractive(target, existingValues, strategy);
  }

  const content = generateFileContent(target, resolved);

  // Ensure parent directory exists
  const dir = path.dirname(target.targetPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(target.targetPath, content, "utf8");
  console.log(`✓ Written: ${target.targetPath}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  // Determine which targets to process
  let selectedIds: TargetId[];

  if (options.targetIds) {
    selectedIds = options.targetIds;
  } else if (options.nonInteractive) {
    console.error("Error: --non-interactive requires --target <id>[,<id>...]");
    process.exit(1);
  } else {
    selectedIds = await promptTargetSelection();
  }

  if (selectedIds.length === 0) {
    console.log("No targets selected. Exiting.");
    return;
  }

  const selectedTargets = selectedIds
    .map((id) => targets.find((t) => t.id === id))
    .filter((t): t is TargetConfig => t !== undefined);

  const unknown = selectedIds.filter((id) => !targets.find((t) => t.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown target ID(s): ${unknown.join(", ")}`);
    console.error(`Valid targets: ${targets.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }

  for (const target of selectedTargets) {
    console.log(`\n─── ${target.label} (${target.targetPath}) ───`);
    await processTarget(target, options);
  }

  console.log("\nDone.");
}

main().catch((err: unknown) => {
  // Gracefully handle Ctrl+C / prompt cancellation
  if (
    err instanceof Error &&
    (err.name === "ExitPromptError" || err.message.includes("User force closed"))
  ) {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
