import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const BACKUP_SCRIPT = path.resolve(__dirname, "../backup-postgres.sh");

type BackupFixture = {
  name: string;
  daysAgo: number;
};

type RunBackupOptions = {
  environment: "production" | "dev";
  env?: Record<string, string>;
  existingBackups?: BackupFixture[];
};

type RunBackupResult = {
  backupDir: string;
  files: string[];
  stdout: string;
  workDir: string;
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function createBackupFile(backupDir: string, fixture: BackupFixture): void {
  const filePath = path.join(backupDir, fixture.name);
  fs.writeFileSync(filePath, `${fixture.name}\n`);

  const mtime = new Date(Date.now() - fixture.daysAgo * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, mtime, mtime);
}

function listBackupFiles(backupDir: string): string[] {
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.endsWith(".sql.gz"))
    .sort();
}

function runBackupScript(options: RunBackupOptions): RunBackupResult {
  const workDir = makeTempDir("backup-postgres-test-");
  const backupDir = path.join(workDir, "backups");
  const fakeBinDir = path.join(workDir, "fake-bin");

  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(fakeBinDir, { recursive: true });

  for (const fixture of options.existingBackups ?? []) {
    createBackupFile(backupDir, fixture);
  }

  writeExecutable(
    path.join(fakeBinDir, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = "exec" ]; then
  printf 'stub backup from %s\\n' "\${2-unknown-container}"
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 1
`,
  );

  writeExecutable(
    path.join(fakeBinDir, "date"),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = "+%Y%m%d_%H%M%S" ]; then
  printf '20260620_120000\\n'
  exit 0
fi
exec /bin/date "$@"
`,
  );

  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    BACKUP_DIR: backupDir,
    ENV_FILE: path.join(workDir, "missing.env"),
    HOME: workDir,
    ...options.env,
  };

  const stdout = execFileSync(
    "bash",
    [BACKUP_SCRIPT, "--environment", options.environment],
    {
      cwd: path.dirname(BACKUP_SCRIPT),
      encoding: "utf8",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return {
    backupDir,
    files: listBackupFiles(backupDir),
    stdout,
    workDir,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("backup-postgres.sh retention", () => {
  it("keeps production backups within the 30-day / 60-file default window", () => {
    const existingBackups = [
      ...Array.from({ length: 65 }, (_, index) => ({
        name: `vakwen_20260619_${String(650000 - index).padStart(6, "0")}.sql.gz`,
        daysAgo: Math.min(index, 29),
      })),
      {
        name: "vakwen_20260501_010101.sql.gz",
        daysAgo: 50,
      },
      {
        name: "vakwen_20260502_010101.sql.gz",
        daysAgo: 49,
      },
    ];

    const result = runBackupScript({
      environment: "production",
      existingBackups,
    });

    expect(result.stdout).toContain("Pruning backups older than 30 days");
    expect(result.files).toHaveLength(60);
    expect(result.files).toContain("vakwen_20260620_120000.sql.gz");
    expect(result.files).not.toContain("vakwen_20260501_010101.sql.gz");
    expect(result.files).not.toContain("vakwen_20260502_010101.sql.gz");
  });

  it("keeps dev backups within the 7-day / 20-file default window", () => {
    const existingBackups = [
      ...Array.from({ length: 24 }, (_, index) => ({
        name: `vakwen_20260618_${String(240000 - index).padStart(6, "0")}.sql.gz`,
        daysAgo: Math.min(index, 6),
      })),
      {
        name: "vakwen_20260601_010101.sql.gz",
        daysAgo: 14,
      },
    ];

    const result = runBackupScript({
      environment: "dev",
      existingBackups,
    });

    expect(result.stdout).toContain("Pruning backups older than 7 days");
    expect(result.files).toHaveLength(20);
    expect(result.files).toContain("vakwen_20260620_120000.sql.gz");
    expect(result.files).not.toContain("vakwen_20260601_010101.sql.gz");
  });

  it("honors BACKUP_RETAIN_DAYS and BACKUP_RETAIN_MAX_FILES overrides", () => {
    const existingBackups = [
      {
        name: "vakwen_20260610_010101.sql.gz",
        daysAgo: 10,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        name: `vakwen_20260619_${String(150000 - index).padStart(6, "0")}.sql.gz`,
        daysAgo: index,
      })),
    ];

    const result = runBackupScript({
      environment: "production",
      env: {
        BACKUP_RETAIN_DAYS: "5",
        BACKUP_RETAIN_MAX_FILES: "3",
      },
      existingBackups,
    });

    expect(result.stdout).toContain("Pruning backups older than 5 days");
    expect(result.files).toHaveLength(3);
    expect(result.files).toContain("vakwen_20260620_120000.sql.gz");
    expect(result.files).not.toContain("vakwen_20260610_010101.sql.gz");
  });

  it("accepts RETAIN_DAYS as a backward-compatible alias", () => {
    const result = runBackupScript({
      environment: "production",
      env: {
        RETAIN_DAYS: "9",
        BACKUP_RETAIN_MAX_FILES: "10",
      },
      existingBackups: [
        {
          name: "vakwen_20260610_010101.sql.gz",
          daysAgo: 10,
        },
        {
          name: "vakwen_20260612_010101.sql.gz",
          daysAgo: 8,
        },
      ],
    });

    expect(result.stdout).toContain("Pruning backups older than 9 days");
    expect(result.files).toContain("vakwen_20260612_010101.sql.gz");
    expect(result.files).not.toContain("vakwen_20260610_010101.sql.gz");
  });
});
