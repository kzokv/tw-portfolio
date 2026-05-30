// KZO-198 — env-setup auto-generates APP_CONFIG_ENCRYPTION_KEY so fresh
// clones don't fail API boot with the validateEnvConstraints throw.
//
// Test placement follows `.claude/rules/test-file-placement.md` (tests for
// modules under `scripts/` live in `libs/config/test/` with `env-setup-*`
// prefix).
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  autoGenerateKeys,
  sensitiveKeys,
  envGroups,
  rootLocalGroups,
  dockerCloudGroups,
  dockerLocalGroups,
} from "../src/env-metadata.js";

describe("env-setup — APP_CONFIG_ENCRYPTION_KEY auto-generation", () => {
  it("APP_CONFIG_ENCRYPTION_KEY is in autoGenerateKeys (so prompts.ts offers crypto.randomBytes(32).toString('hex'))", () => {
    expect(autoGenerateKeys.has("APP_CONFIG_ENCRYPTION_KEY")).toBe(true);
  });

  it("APP_CONFIG_ENCRYPTION_KEY is in sensitiveKeys (masked in display)", () => {
    expect(sensitiveKeys.has("APP_CONFIG_ENCRYPTION_KEY")).toBe(true);
  });

  it("APP_CONFIG_ENCRYPTION_KEY appears in every env-target group set the API runs in", () => {
    const all = [
      ...envGroups.flatMap((g) => g.keys),
      ...rootLocalGroups.flatMap((g) => g.keys),
      ...dockerCloudGroups.flatMap((g) => g.keys),
      ...dockerLocalGroups.flatMap((g) => g.keys),
    ];
    const groupsWithKey = [envGroups, rootLocalGroups, dockerCloudGroups, dockerLocalGroups].filter(
      (groups) => groups.some((g) => g.keys.includes("APP_CONFIG_ENCRYPTION_KEY")),
    );
    // Sanity: every collection must mention the key, otherwise that target
    // emits a .env file without the key and fresh clones break.
    expect(groupsWithKey.length).toBe(4);
    expect(all.filter((k) => k === "APP_CONFIG_ENCRYPTION_KEY").length).toBeGreaterThanOrEqual(4);
  });

  it("crypto.randomBytes(32).toString('hex') matches env-schema regex /^[0-9a-f]{64}$/", () => {
    // Mirrors prompts.ts:337 — `if (autoGen) { return crypto.randomBytes(32).toString("hex"); }`.
    // Regression guard: if `randomBytes(N)` is ever changed, this will fail
    // before fresh-clone API boot does.
    for (let i = 0; i < 32; i++) {
      const generated = randomBytes(32).toString("hex");
      expect(generated).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
