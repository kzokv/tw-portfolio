import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const DOCKER_DISK_HELPER = path.resolve(
  __dirname,
  "../lib/docker-disk.sh",
);

const cleanupCandidates = [
  "docker_disk_bounded_cleanup",
  "docker_disk_cleanup_bounded",
  "cleanup_docker_disk_bounded",
  "run_bounded_docker_cleanup",
  "docker_disk_cleanup",
  "docker_disk_exit_cleanup",
];

const thresholdCandidates = [
  "docker_disk_require_minimums",
  "docker_disk_preflight_build",
  "docker_disk_has_enough_free_space",
  "docker_disk_has_free_space",
  "docker_disk_meets_thresholds",
  "docker_disk_threshold_ok",
  "check_docker_disk_thresholds",
  "ensure_docker_disk_thresholds",
  "validate_docker_disk_thresholds",
  "docker_disk_below_threshold",
  "docker_disk_needs_cleanup",
];

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function extractFunctionNames(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  return Array.from(
    source.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/gm),
    (match) => match[1],
  );
}

function inferThresholdSemantics(functionName: string): "enough" | "low" {
  return /below|insufficient|needs_cleanup|low/.test(functionName)
    ? "low"
    : "enough";
}

function runShell(script: string, env: Record<string, string>): string {
  return execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function parseLastLineAsInt(output: string): number {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return Number.parseInt(lines.at(-1) ?? "", 10);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("docker-disk helper", () => {
  it("exists for the locked deployment disk cleanup scope", () => {
    expect(fs.existsSync(DOCKER_DISK_HELPER)).toBe(true);
  });

  it("constructs bounded cleanup commands without a live Docker daemon", () => {
    expect(fs.existsSync(DOCKER_DISK_HELPER)).toBe(true);

    const availableFunctions = extractFunctionNames(DOCKER_DISK_HELPER);
    const cleanupFunction = cleanupCandidates.find((name) =>
      availableFunctions.includes(name),
    );

    expect(cleanupFunction).toBeTruthy();

    const workDir = makeTempDir("docker-disk-cleanup-");
    const fakeBinDir = path.join(workDir, "fake-bin");
    const dockerLog = path.join(workDir, "docker.log");

    fs.mkdirSync(fakeBinDir, { recursive: true });

    writeExecutable(
      path.join(fakeBinDir, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${dockerLog}"
if [ "\${1-}" = "info" ]; then
  if [ "\${2-}" = "--format" ]; then
    printf '/var/lib/docker\\n'
  fi
  exit 0
fi
exit 0
`,
    );

    runShell(
      `set -euo pipefail
source "${DOCKER_DISK_HELPER}"
${cleanupFunction!}
`,
      {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        DEPLOY_BUILDER_KEEP_STORAGE: "17GB",
      },
    );

    const commands = fs.readFileSync(dockerLog, "utf8");
    expect(commands).toContain("container prune -f");
    expect(commands).toContain("image prune -f");
    expect(commands).toContain("builder prune -f --keep-storage 17GB");
  });

  it("adds an explicit Docker binary path when Docker is absent from PATH", () => {
    const workDir = makeTempDir("docker-disk-bin-");
    const dockerBinDir = path.join(workDir, "qnap-bin");
    const dockerBin = path.join(dockerBinDir, "docker");

    fs.mkdirSync(dockerBinDir, { recursive: true });
    writeExecutable(
      dockerBin,
      `#!/usr/bin/env bash
exit 0
`,
    );

    const resolvedDocker = runShell(
      `set -euo pipefail
source "${DOCKER_DISK_HELPER}"
command -v docker
`,
      {
        PATH: "/usr/bin:/bin",
        DEPLOY_DOCKER_BIN: dockerBin,
      },
    ).trim();

    expect(resolvedDocker).toBe(dockerBin);
  });

  it("uses an accessible parent filesystem when Docker root cannot be inspected directly", () => {
    const workDir = makeTempDir("docker-disk-parent-");
    const fakeBinDir = path.join(workDir, "fake-bin");
    const dockerRootDir = path.join(workDir, "private", "docker");

    fs.mkdirSync(fakeBinDir, { recursive: true });

    writeExecutable(
      path.join(fakeBinDir, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = "info" ] && [ "\${2-}" = "--format" ]; then
  printf '%s\\n' "${dockerRootDir}"
  exit 0
fi
if [ "\${1-}" = "info" ]; then
  exit 0
fi
exit 0
`,
    );

    writeExecutable(
      path.join(fakeBinDir, "df"),
      `#!/usr/bin/env bash
set -euo pipefail
target="\${@: -1}"
if [ "$target" != "${workDir}" ]; then
  exit 1
fi
cat <<EOF
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk1 104857600 62914560 41943040 60% ${workDir}
EOF
`,
    );

    const output = runShell(
      `set -euo pipefail
source "${DOCKER_DISK_HELPER}"
docker_disk_collect_metrics
printf '%s\\n' "$DOCKER_DISK_ROOT_DIR"
printf '%s\\n' "$DOCKER_DISK_DF_TARGET"
`,
      {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    )
      .trim()
      .split("\n");

    expect(output.at(-2)).toBe(dockerRootDir);
    expect(output.at(-1)).toBe(workDir);
  });

  it("evaluates threshold decisions from stubbed disk readings", () => {
    expect(fs.existsSync(DOCKER_DISK_HELPER)).toBe(true);

    const availableFunctions = extractFunctionNames(DOCKER_DISK_HELPER);
    const thresholdFunction = thresholdCandidates.find((name) =>
      availableFunctions.includes(name),
    );

    expect(thresholdFunction).toBeTruthy();

    const semantics = inferThresholdSemantics(thresholdFunction!);
    const workDir = makeTempDir("docker-disk-threshold-");
    const fakeBinDir = path.join(workDir, "fake-bin");
    const dockerRootDir = path.join(workDir, "docker-root");

    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(dockerRootDir, { recursive: true });

    writeExecutable(
      path.join(fakeBinDir, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1-}" = "info" ] && [ "\${2-}" = "--format" ]; then
  printf '%s\\n' "${dockerRootDir}"
  exit 0
fi
if [ "\${1-}" = "info" ]; then
  exit 0
fi
if [ "\${1-}" = "system" ] && [ "\${2-}" = "df" ]; then
  cat <<'EOF'
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          10        5         20GB      10GB (50%)
Containers      5         2         1GB       500MB (50%)
Local Volumes   3         1         5GB       2GB (40%)
Build Cache     8         0         7GB       7GB
EOF
  exit 0
fi
exit 0
`,
    );

    writeExecutable(
      path.join(fakeBinDir, "df"),
      `#!/usr/bin/env bash
set -euo pipefail
cat <<EOF
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk1 ${"$"}{DF_BLOCKS:?} ${"$"}{DF_USED:?} ${"$"}{DF_AVAILABLE:?} ${"$"}{DF_CAPACITY:?}% ${dockerRootDir}
EOF
`,
    );

    const enoughExitCode = parseLastLineAsInt(
      runShell(
        `set +e
source "${DOCKER_DISK_HELPER}"
${thresholdFunction!}
status=$?
printf '%s\\n' "$status"
`,
        {
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          DF_BLOCKS: "104857600",
          DF_USED: "62914560",
          DF_AVAILABLE: "41943040",
          DF_CAPACITY: "60",
          DEPLOY_MIN_DOCKER_FREE_GB: "25",
          DEPLOY_MIN_DOCKER_FREE_PERCENT: "15",
        },
      ),
    );

    const lowExitCode = parseLastLineAsInt(
      runShell(
        `set +e
source "${DOCKER_DISK_HELPER}"
${thresholdFunction!}
status=$?
printf '%s\\n' "$status"
`,
        {
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          DF_BLOCKS: "104857600",
          DF_USED: "94371840",
          DF_AVAILABLE: "10485760",
          DF_CAPACITY: "90",
          DEPLOY_MIN_DOCKER_FREE_GB: "25",
          DEPLOY_MIN_DOCKER_FREE_PERCENT: "15",
        },
      ),
    );

    if (semantics === "enough") {
      expect(enoughExitCode).toBe(0);
      expect(lowExitCode).not.toBe(0);
    } else {
      expect(enoughExitCode).not.toBe(0);
      expect(lowExitCode).toBe(0);
    }
  });

  it("attempts bounded cleanup before failing a low-disk build preflight", () => {
    expect(fs.existsSync(DOCKER_DISK_HELPER)).toBe(true);

    const workDir = makeTempDir("docker-disk-preflight-");
    const fakeBinDir = path.join(workDir, "fake-bin");
    const dockerRootDir = path.join(workDir, "docker-root");
    const dockerLog = path.join(workDir, "docker.log");

    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.mkdirSync(dockerRootDir, { recursive: true });

    writeExecutable(
      path.join(fakeBinDir, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${dockerLog}"
if [ "\${1-}" = "info" ] && [ "\${2-}" = "--format" ]; then
  printf '%s\\n' "${dockerRootDir}"
  exit 0
fi
if [ "\${1-}" = "info" ]; then
  exit 0
fi
if [ "\${1-}" = "system" ] && [ "\${2-}" = "df" ]; then
  printf 'TYPE TOTAL ACTIVE SIZE RECLAIMABLE\\n'
  exit 0
fi
exit 0
`,
    );

    writeExecutable(
      path.join(fakeBinDir, "df"),
      `#!/usr/bin/env bash
set -euo pipefail
cat <<EOF
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk1 104857600 94371840 10485760 90% ${dockerRootDir}
EOF
`,
    );

    const exitCode = parseLastLineAsInt(
      runShell(
        `set +e
source "${DOCKER_DISK_HELPER}"
docker_disk_preflight_build "test preflight"
status=$?
printf '%s\\n' "$status"
`,
        {
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          DEPLOY_MIN_DOCKER_FREE_GB: "25",
          DEPLOY_MIN_DOCKER_FREE_PERCENT: "15",
          DEPLOY_BUILDER_KEEP_STORAGE: "11GB",
        },
      ),
    );

    const commands = fs.readFileSync(dockerLog, "utf8");
    expect(exitCode).not.toBe(0);
    expect(commands).toContain("container prune -f");
    expect(commands).toContain("image prune -f");
    expect(commands).toContain("builder prune -f --keep-storage 11GB");
  });
});
