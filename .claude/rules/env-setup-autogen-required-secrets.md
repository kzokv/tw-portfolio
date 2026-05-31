# env-setup Auto-Gen Registration for New Required Secrets — Same PR

Any new `Env` schema entry validated as required at boot (`Env.validateEnvConstraints()` throws when missing) MUST be registered in `scripts/env-setup/`'s auto-generation set in the SAME PR.

Fresh clones do `npm install && npm run env:setup && npm run dev`. If the new required secret isn't on the auto-gen list, the wizard skips it, the user runs the API, and boot fails with a "missing required env var" throw. First-run UX is broken.

## The 3-line registration

In `libs/config/src/env-metadata.ts`:

```ts
export const sensitiveKeys = new Set([..., "APP_CONFIG_ENCRYPTION_KEY"]);
export const autoGenerateKeys = new Set([..., "APP_CONFIG_ENCRYPTION_KEY"]);
// Plus add the var to envGroups (root + docker-cloud + docker-local Application sections).
```

`scripts/env-setup/prompts.ts` then offers "Auto-generate APP_CONFIG_ENCRYPTION_KEY?" and on confirm returns `crypto.randomBytes(32).toString("hex")` (matching schema regex `/^[0-9a-f]{64}$/`).

For non-hex shapes (UUIDs, base64, custom-format keys), wire the generator to produce the correct shape — confirm against the schema regex with a unit test.

## Companion: shell-quote values containing spaces or special chars

Generators that write `.env` files MUST double-quote any value containing spaces or shell-special characters. `set -a; source .env; set +a` parses `CRON=30 17 * * 1-5` as `CRON=30` followed by the command `17 * * 1-5` — silent corruption (the env var holds only `30`) or a runtime error from a non-existent command.

```ts
const SHELL_SPECIAL_RE = /[\s*?[\]();|&<>\\`$'"\n]/;

function shellQuoteEnvValue(value: string): string {
  if (!SHELL_SPECIAL_RE.test(value)) return value;          // pass-through plain
  if (/^("|').*\1$/.test(value)) return value;              // already quoted (idempotent)
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

// Used by generator:
lines.push(`${key}=${shellQuoteEnvValue(rv.value)}`);
```

Pair with a regression test: run `bash -n <generated>` AND a `source` roundtrip asserting the multi-word value is recovered intact.

Cron strings are the most common trigger. Future env vars with spaces (display names, multi-word phrases) hit the same trap.

## Pre-PR checklist when adding a required env var

For every new entry in `libs/config/src/env-schema.ts` with `.min(1)` / `.regex(...)` / no `.default(...)` (i.e., would throw at `validateEnvConstraints` when missing):

1. Add to `sensitiveKeys` if it carries credentials/secrets.
2. Add to `autoGenerateKeys` if it can be safely machine-generated (HMAC keys, encryption keys, opaque tokens). Skip for vars that need human input (API keys from external providers, hostnames).
3. Add to the relevant `envGroups` section so the wizard prompts for it.
4. If the value can contain spaces or shell-special characters, ensure the generator routes through `shellQuoteEnvValue`.
5. Test: fresh clone → `npm run env:setup` → the new var appears in `.env.local` AND the API boots without throwing.

This is the same checklist level as "did I add it to `.env.example`?" — same PR or it's broken on first run.

## Why

KZO-198 — `APP_CONFIG_ENCRYPTION_KEY` shipped without auto-gen registration. User reported fresh-clone API boot failure on first try. KZO-198 Task #11 — three cron env vars (`CATALOG_SYNC_CRON`, `FX_REFRESH_CRON`, `ANONYMOUS_SHARE_TOKEN_PURGE_CRON`) shipped without quoting; user's `npm run dev:local:bypass:mem` failed at `bash` source-time with `17: command not found`. Both bugs were trivial to fix (3-line registration + 1-function shell-quote helper) but were caught by the user, not by the test suite — a tooling gap that the rule converts to a checklist step.

## How to apply

Any PR that adds a new entry to `libs/config/src/env-schema.ts` (or any `Env` schema). The auto-gen registration and shell-quote audit belong in the same diff as the schema change. Code Reviewer should grep `git diff libs/config/src/env-schema.ts` for new keys and verify each appears in `env-metadata.ts`'s `autoGenerateKeys` (or has a documented reason to be human-input only).
