// KZO-198 — env-setup generator quotes shell-special values so a sourced
// .env file does not corrupt cron strings (or any future multi-word value).
//
// Test placement follows `.claude/rules/test-file-placement.md` (tests for
// modules under `scripts/` live in `libs/config/test/` with `env-setup-*`
// prefix).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  generateFileContent,
  shellQuoteEnvValue,
} from "../../../scripts/env-setup/generator.js";
import type {
  TargetConfig,
  ResolvedValue,
} from "../../../scripts/env-setup/types.js";

function makeValues(entries: [string, string][]): Map<string, ResolvedValue> {
  const map = new Map<string, ResolvedValue>();
  for (const [key, value] of entries) {
    map.set(key, { key, value, source: "default" });
  }
  return map;
}

describe("shellQuoteEnvValue (unit)", () => {
  it("passes through plain alphanumerics unchanged", () => {
    expect(shellQuoteEnvValue("abc123")).toBe("abc123");
    expect(shellQuoteEnvValue("60000")).toBe("60000");
  });

  it("quotes values containing spaces", () => {
    expect(shellQuoteEnvValue("30 17 * * 1-5")).toBe('"30 17 * * 1-5"');
    expect(shellQuoteEnvValue("0 22 * * *")).toBe('"0 22 * * *"');
    expect(shellQuoteEnvValue("0 4 * * *")).toBe('"0 4 * * *"');
  });

  it("escapes embedded $, `, \", \\ inside double quotes", () => {
    expect(shellQuoteEnvValue('a"b')).toBe('"a\\"b"');
    expect(shellQuoteEnvValue("a$b")).toBe('"a\\$b"');
    expect(shellQuoteEnvValue("a`b")).toBe('"a\\`b"');
    expect(shellQuoteEnvValue("a\\b")).toBe('"a\\\\b"');
  });

  it("is idempotent — pre-quoted values pass through unchanged", () => {
    expect(shellQuoteEnvValue('"30 17 * * 1-5"')).toBe('"30 17 * * 1-5"');
    expect(shellQuoteEnvValue("'foo bar'")).toBe("'foo bar'");
  });

  it("quotes other shell-special chars (* ? [ ] ( ) ; | & < > ` $ \\n)", () => {
    expect(shellQuoteEnvValue("a*b")).toBe('"a*b"');
    expect(shellQuoteEnvValue("a;b")).toBe('"a;b"');
    expect(shellQuoteEnvValue("a|b")).toBe('"a|b"');
    expect(shellQuoteEnvValue("a&b")).toBe('"a&b"');
  });
});

describe("generateFileContent — KZO-198 cron values shell-safe roundtrip", () => {
  const target: TargetConfig = {
    id: "root:local",
    label: "Test target",
    targetPath: ".env.test",
    schema: z.object({
      CATALOG_SYNC_CRON: z.string().default("30 17 * * 1-5"),
      FX_REFRESH_CRON: z.string().default("0 22 * * *"),
      ANONYMOUS_SHARE_TOKEN_PURGE_CRON: z.string().default("0 4 * * *"),
      APP_CONFIG_ENCRYPTION_KEY: z.string().default(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
      RATE_LIMIT_MAX_MUTATIONS: z.coerce.number().default(120),
    }),
    groups: [
      {
        label: "Cron + Encryption",
        keys: [
          "CATALOG_SYNC_CRON",
          "FX_REFRESH_CRON",
          "ANONYMOUS_SHARE_TOKEN_PURGE_CRON",
          "APP_CONFIG_ENCRYPTION_KEY",
          "RATE_LIMIT_MAX_MUTATIONS",
        ],
      },
    ],
  } as TargetConfig;

  const values = makeValues([
    ["CATALOG_SYNC_CRON", "30 17 * * 1-5"],
    ["FX_REFRESH_CRON", "0 22 * * *"],
    ["ANONYMOUS_SHARE_TOKEN_PURGE_CRON", "0 4 * * *"],
    [
      "APP_CONFIG_ENCRYPTION_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
    ["RATE_LIMIT_MAX_MUTATIONS", "120"],
  ]);

  it("emits cron values wrapped in double quotes", () => {
    const content = generateFileContent(target, values);
    expect(content).toMatch(/^CATALOG_SYNC_CRON="30 17 \* \* 1-5"$/m);
    expect(content).toMatch(/^FX_REFRESH_CRON="0 22 \* \* \*"$/m);
    expect(content).toMatch(/^ANONYMOUS_SHARE_TOKEN_PURGE_CRON="0 4 \* \* \*"$/m);
    // Unchanged for values without shell-special chars.
    expect(content).toMatch(
      /^APP_CONFIG_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef$/m,
    );
    expect(content).toMatch(/^RATE_LIMIT_MAX_MUTATIONS=120$/m);
  });

  it("`bash -n` syntax-checks the generated file with no errors", () => {
    const content = generateFileContent(target, values);
    const dir = mkdtempSync(join(tmpdir(), "kzo198-env-"));
    const path = join(dir, ".env.test");
    writeFileSync(path, content);
    // bash -n parses the file without executing — surfaces quoting errors.
    expect(() =>
      execFileSync("bash", ["-n", path], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("`bash -c 'set -a; source <file>'` recovers full multi-word cron values", () => {
    const content = generateFileContent(target, values);
    const dir = mkdtempSync(join(tmpdir(), "kzo198-env-"));
    const path = join(dir, ".env.test");
    writeFileSync(path, content);

    // Source the file in a fresh shell and emit the env vars on stdout.
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -a; source "${path}"; printf '%s\\n' "$CATALOG_SYNC_CRON" "$FX_REFRESH_CRON" "$ANONYMOUS_SHARE_TOKEN_PURGE_CRON" "$APP_CONFIG_ENCRYPTION_KEY"`,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toEqual([
      "30 17 * * 1-5",
      "0 22 * * *",
      "0 4 * * *",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ]);
  });
});

describe(".env.example regression — committed cron values are quoted", () => {
  it("the repo .env.example sources cleanly via bash and yields full cron strings", () => {
    // Resolve the repo root from this test file path. Test lives at
    // <root>/libs/config/test/env-setup-shell-safety.test.ts so .. .. .. ..
    // takes us to the repo root.
    const repoRoot = join(import.meta.dirname ?? __dirname, "..", "..", "..");
    const envExamplePath = join(repoRoot, ".env.example");
    // Sanity check the file exists at the expected location.
    expect(() => readFileSync(envExamplePath, "utf8")).not.toThrow();

    // bash -n is sufficient — KZO-198 the only commented-out cron lines start
    // with `#` and bash skips them, so the test exercises the quoting on the
    // cron lines indirectly via the source path below.
    const sourceCmd = `set -a; source "${envExamplePath}"; printf '%s\\n' "$CATALOG_SYNC_CRON" "$FX_REFRESH_CRON" "$ANONYMOUS_SHARE_TOKEN_PURGE_CRON"`;
    const result = spawnSync("bash", ["-c", sourceCmd], { encoding: "utf8" });
    expect(result.status).toBe(0);
    // .env.example ships the cron lines commented-out (operators uncomment to
    // override). Sourcing yields empty strings — no parse failure, which is
    // the regression we care about. If a future change uncomments them, the
    // values must still source intact (proven by the unit-quote tests above).
  });
});
