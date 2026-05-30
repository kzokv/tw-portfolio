import fs from "node:fs/promises";
import path from "node:path";

export interface MigrationManifest {
  baselineMigration: string | null;
  baselineSupersedes: string[];
  numberedMigrations: string[];
}

export async function loadMigrationManifest(migrationsDir: string): Promise<MigrationManifest> {
  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b));
  const availableFiles = new Set([...(await fs.readdir(migrationsDir)), ...migrationFiles]);
  const manifest = await parseManifestFile(path.join(migrationsDir, "manifest.env"));
  const baselineMigration = manifest.BASELINE_MIGRATION?.trim() || null;
  const baselineSupersedes = splitCsvList(manifest.BASELINE_SUPERSEDES);

  if (baselineMigration && !availableFiles.has(baselineMigration)) {
    throw new Error(`Baseline migration "${baselineMigration}" not found in ${migrationsDir}`);
  }

  const numberedSet = new Set(migrationFiles);
  for (const migrationName of baselineSupersedes) {
    if (!numberedSet.has(migrationName)) {
      throw new Error(`Baseline supersedes unknown migration "${migrationName}"`);
    }
  }

  return {
    baselineMigration,
    baselineSupersedes,
    numberedMigrations: migrationFiles,
  };
}

async function parseManifestFile(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entries: Record<string, string> = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        throw new Error(`Invalid migration manifest line: ${trimmed}`);
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!key) {
        throw new Error(`Invalid migration manifest line: ${trimmed}`);
      }
      entries[key] = value;
    }

    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function splitCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
