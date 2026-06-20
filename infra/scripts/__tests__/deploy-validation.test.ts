import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";

const DEPLOY_SCRIPT = path.resolve(__dirname, "../deploy.sh");

/**
 * All required keys that validate_env_file_keys checks before
 * reaching the AUTH_USER_ID guard. We provide dummy values so the
 * test isolates the AUTH_USER_ID validation logic.
 */
const REQUIRED_ENV: Record<string, string> = {
  POSTGRES_PASSWORD: "test",
  REDIS_PASSWORD: "test",
  CLOUDFLARE_TUNNEL_TOKEN: "test",
  PUBLIC_DOMAIN_WEB: "test.com",
  PUBLIC_DOMAIN_API: "api.test.com",
  AUTH_MODE: "oauth",
  PERSISTENCE_BACKEND: "memory",
};

/**
 * Extracts validate_env_file_keys from deploy.sh and runs it with
 * the given env vars. Returns { exitCode, stderr }.
 */
function runValidation(envOverrides: Record<string, string>): {
  exitCode: number;
  stderr: string;
} {
  const env = { ...REQUIRED_ENV, ...envOverrides };

  // Build export statements for each env var
  const exportLines = Object.entries(env)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join("\n");

  // Write a temp script that extracts the function from deploy.sh and calls it.
  // ENV_FILE is used in error messages but not read; set a placeholder.
  const script = `#!/usr/bin/env bash
set -euo pipefail
${exportLines}
ENV_FILE="test.env"
eval "$(sed -n '/^validate_env_file_keys()/,/^}/p' '${DEPLOY_SCRIPT}')"
validate_env_file_keys
`;

  const tmpFile = path.join(os.tmpdir(), `deploy-validation-${Date.now()}.sh`);
  fs.writeFileSync(tmpFile, script, { mode: 0o755 });

  try {
    execSync(`bash "${tmpFile}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stderr: String(e.stderr ?? ""),
    };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

describe("deploy.sh validate_env_file_keys — AUTH_USER_ID guard", () => {
  it("AUTH_MODE=oauth + AUTH_USER_ID set → exit 1 with error on stderr", () => {
    const result = runValidation({
      AUTH_MODE: "oauth",
      AUTH_USER_ID: "user-1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AUTH_USER_ID must not be set");
    expect(result.stderr).toContain("identity conflict");
  });

  it("AUTH_MODE=oauth + AUTH_USER_ID unset → passes validation", () => {
    // Explicitly exclude AUTH_USER_ID from env
    const env = { ...REQUIRED_ENV, AUTH_MODE: "oauth" };
    delete (env as Record<string, string | undefined>).AUTH_USER_ID;

    const result = runValidation({ AUTH_MODE: "oauth" });

    expect(result.exitCode).toBe(0);
  });

  it("AUTH_MODE=dev_bypass + AUTH_USER_ID set → passes validation", () => {
    const result = runValidation({
      AUTH_MODE: "dev_bypass",
      AUTH_USER_ID: "user-1",
    });

    expect(result.exitCode).toBe(0);
  });
});

describe("deploy.sh rollback and migration disk preflight safeguards", () => {
  it("checks migration image build disk space before stopping the running stack", () => {
    const source = fs.readFileSync(DEPLOY_SCRIPT, "utf8");
    const migrationsPhase = source.slice(source.indexOf('phase_start "Database migrations"'));

    expect(migrationsPhase.indexOf('docker_disk_preflight_build "Migration image build preflight"')).toBeGreaterThanOrEqual(0);
    expect(migrationsPhase.indexOf("dc down --remove-orphans --timeout 10")).toBeGreaterThanOrEqual(0);
    expect(
      migrationsPhase.indexOf('docker_disk_preflight_build "Migration image build preflight"'),
    ).toBeLessThan(migrationsPhase.indexOf("dc down --remove-orphans --timeout 10"));
  });

  it("rolls back with the preserved previous image tag even when rollback preflight is low", () => {
    const source = fs.readFileSync(DEPLOY_SCRIPT, "utf8");
    const rollbackFunction = source.slice(
      source.indexOf("rollback() {"),
      source.indexOf("wait_for_healthcheck() {"),
    );

    expect(source).toContain('ROLLBACK_IMAGE_TAG="$(git rev-parse --short "$PREVIOUS_SHA")"');
    expect(source).toContain('preserve_rollback_images "$ROLLBACK_IMAGE_TAG"');
    expect(rollbackFunction).toContain('IMAGE_TAG="${ROLLBACK_IMAGE_TAG:-$(git rev-parse --short "$PREVIOUS_SHA")}"');
    expect(rollbackFunction).toContain("attempting rollback image build anyway");
    expect(rollbackFunction).toContain("restore_explicit_runtime_tag_from_rollback_images");
    expect(rollbackFunction).not.toContain("Skipping rollback image build because Docker disk preflight failed");
  });

  it("restores explicit runtime image tags before post-build pre-migration exits", () => {
    const source = fs.readFileSync(DEPLOY_SCRIPT, "utf8");
    const buildFailureBlock = source.slice(
      source.indexOf('if ! run_with_heartbeat "image build"'),
      source.indexOf("phase_done", source.indexOf('if ! run_with_heartbeat "image build"')),
    );
    const migrationPreflightBlock = source.slice(
      source.indexOf('if ! docker_disk_preflight_build "Migration image build preflight"'),
      source.indexOf("# Remove stale containers", source.indexOf('if ! docker_disk_preflight_build "Migration image build preflight"')),
    );

    expect(source).toContain("restore_explicit_runtime_tag_on_failed_pre_migration_exit()");
    expect(source).toContain('restore_runtime_image_tags "$ROLLBACK_IMAGE_TAG" "$IMAGE_TAG_EXPLICIT"');
    expect(buildFailureBlock).toContain("restore_explicit_runtime_tag_on_failed_pre_migration_exit");
    expect(migrationPreflightBlock).toContain("restore_explicit_runtime_tag_on_failed_pre_migration_exit");
  });
});
