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
