---
slug: kzo-153
source: scope-grill
created: 2026-04-21
tickets: [KZO-153]
required_reading: [docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md]
superseded_by: null
---

# Todo: KZO-153 — Deferred integration tests for admin CLI scripts + migration 030 collision detection

> **For agents starting a fresh session:** read `required_reading` first. KZO-143 landed the CLI scripts, persistence methods, and migration 030 itself; this ticket only adds the deferred test coverage + a small CLI refactor for testability. Parent ticket: KZO-141. Related (not blocking): KZO-143.

## Context (why this ticket exists)

KZO-143 explicitly deferred three integration tests:
1. `npm run admin:promote` shell-wrapper coverage
2. `npm run admin:bootstrap-invite` shell-wrapper coverage
3. Migration 030's pre-backfill email-collision detection (`RAISE EXCEPTION` on duplicate lowercase emails)

Persistence methods (`promoteUserToAdminByEmail`, `insertBootstrapInvite`) are already unit- and integration-tested. What was deferred is the **entry-file surface**: argv parsing, createPersistence wiring, stdout/stderr/exit-code contract, and the migration's collision abort path.

## Key scope decisions (all Phase 1 — no debate triggered)

- **In-process CLI invocation via `await import` + `process.argv` injection** (not shell-spawn). Shell-spawn adds ~2 min runtime for zero unique regression coverage beyond what in-process catches.
- **Export `main(argv)` from each CLI + add `import.meta.url` entry guard** so tests can call `main` directly without ESM-cache gymnastics. Use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])` (not literal `'file://' + argv[1]`).
- **Pretty-print ZodErrors in both CLIs** (`invalid email: ...`, `invalid role: ...` + `exitCode = 1`) instead of raw stack traces.
- **Postgres-only suite** — no memory sibling block. CLIs are operational Postgres tools; memory execution has no semantic contract to pin.
- **Pin observed behavior** for two ambiguous cases:
  - `admin:bootstrap-invite` re-run on an email with no user yet inserts a SECOND valid invite (no unique-on-email constraint on `invites`). Not a bug; re-issuing an invite is a legitimate operator workflow. Out of scope: changing this.
  - `admin:promote` re-run on an already-admin user emits a second `admin_promote_cli` audit row. Consistent with the startup variant; out of scope to change `promoteUserToAdminByEmail` semantics here.
- **Env wiring via `vi.mock("@tw-portfolio/config", ...)`** — overrides `Env.PERSISTENCE_BACKEND`, `Env.DB_URL`, `Env.REDIS_URL` to the managed `POSTGRES_TEST_*` variants. `createPersistence()` calls these at invocation time, so the mock takes effect before `main()` runs.

## Implementation Steps

### A. CLI refactor — `apps/api/src/cli/adminPromote.ts`

- [ ] Change `async function main(): Promise<void>` → `export async function main(argv: string[]): Promise<void>`; replace all `process.argv[N]` reads with `argv[N]`.
- [ ] Wrap the `emailSchema.parse(emailArg)` call in a try/catch for `z.ZodError`; on catch, `console.error(\`invalid email: \${emailArg}\`)` + `process.exitCode = 1` + `return`.
- [ ] Replace `void main();` with:
  ```ts
  import { fileURLToPath } from "node:url";
  import path from "node:path";
  if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    void main(process.argv);
  }
  ```

### B. CLI refactor — `apps/api/src/cli/adminBootstrapInvite.ts`

- [ ] Same `export async function main(argv: string[])` signature + argv threading.
- [ ] ZodError try/catch covers both `emailSchema.parse` AND `roleSchema.parse`; distinct error messages (`invalid email: ...` vs `invalid role: ...`).
- [ ] Same `import.meta.url` entry guard.

### C. New test file — `apps/api/test/integration/admin-cli.integration.test.ts`

- [ ] Top-of-file `vi.mock("@tw-portfolio/config", ...)` per Env-wiring decision above.
- [ ] `describePostgres` guard matching `admin-management.integration.test.ts` (managed-stack env var checks, migration manifest loader, scoped `Pool` in `beforeEach`, full `applyNumberedMigrations`).
- [ ] `beforeEach` does NOT need to seed an admin actor — CLI audit rows use `actor_user_id = NULL`.
- [ ] Shared helper: `async function runMain(cliModule, argv): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }>` — spies `console.log`/`console.error`, resets `process.exitCode = 0`, awaits `main(argv)`, captures + restores.

### D. `describe("admin:promote", ...)` — 6 cases

- [ ] **happy path**: seed member user via `persistence.resolveOrCreateUser`; `main(["node", "script", "admin@example.com"])`; assert exit 0, stdout matches `/^Promoted admin@example\.com \([0-9a-f-]+\) to admin$/`, DB `role='admin'`, `admin_promote_cli` audit row with `actor_user_id IS NULL`, `target_user_id = user.id`, `metadata.targetEmail = "admin@example.com"`.
- [ ] **no-matching-user**: no seed; expect exit 1, stderr `user must sign in first, or issue an invite`, no audit row.
- [ ] **usage / missing argv**: `main(["node", "script"])`; expect exit 1, stderr includes `Usage:`.
- [ ] **invalid email (ZodError)**: `main(["node", "script", "not-an-email"])`; expect exit 1, stderr `includes("invalid email")`.
- [ ] **already-admin re-run**: seed admin user (via `changeUserRole` or mint with `role='admin'`); run `main` once; assert exit 0, role still `admin`, AND a second `admin_promote_cli` audit row IS emitted (observed behavior pinned).
- [ ] **deactivated user**: seed user with `deactivated_at IS NOT NULL` (via `disableUser` or direct SQL); expect exit 1, no role change, no audit row. Mirrors `admin-bootstrap.integration.test.ts:133-152`.

### E. `describe("admin:bootstrap-invite", ...)` — 7 cases

- [ ] **happy path**: no user; `main(["node", "script", "newbie@example.com", "member"])`; expect exit 0, stdout contains `Created invite` + URL line with the invite code; DB row: `role='member'`, `expires_at` within ±5s of `NOW()+7d`, `issued_by_user_id IS NULL`, `used_at IS NULL`, `revoked_at IS NULL`.
- [ ] **user already exists**: seed user first; expect exit 1, stderr `A user with that email already exists`, `listInvites` returns 0 rows.
- [ ] **usage / missing argv**: two sub-cases — `main(["node", "script"])` and `main(["node", "script", "e@x.com"])`; both exit 1, stderr `Usage:`.
- [ ] **invalid email (ZodError)**: `main(["node", "script", "not-an-email", "member"])`; exit 1, stderr `includes("invalid email")`.
- [ ] **invalid role (ZodError)**: `main(["node", "script", "e@x.com", "super"])`; exit 1, stderr `includes("invalid role")`.
- [ ] **double-run, no user yet**: call `main` twice with the same `(email, role)`; assert `listInvites` returns 2 distinct rows (different `code`), both reporting `valid` via `getInviteStatus`.
- [ ] **no audit entry written**: after happy path, `listAuditLog` returns no row whose `metadata.inviteCode` matches the created code. Documents that the CLI path skips audit (unlike HTTP `POST /invites`).

### F. Migration 030 collision test — `apps/api/test/integration/postgres-migrations.integration.test.ts`

- [ ] Add new `it("migration 030 rejects duplicate lowercase emails", ...)` inside the existing `describePostgres` block.
- [ ] Reset schema, apply migrations through 029 via `applyMigrationFiles(await getNumberedMigrationsBefore("030_kzo143_auth_foundations.sql"))`.
- [ ] Raw INSERT two users: `(id='u1', email='Foo@example.com')` and `(id='u2', email='foo@example.com')` — plus the NOT NULL columns present post-029 (`locale='en'`, `cost_basis_method='WEIGHTED_AVERAGE'`, `quote_poll_interval_seconds=10`, `is_demo=false` via migration 015 default).
- [ ] Expect `applyMigrationFiles(["030_kzo143_auth_foundations.sql"])` to reject; assert error message `includes("KZO-143 migration aborted: duplicate lowercase emails require manual cleanup")`.
- [ ] Post-failure positive assertions: both user rows still present with ORIGINAL-CASE emails (rollback verified); `ux_users_email` (case-sensitive, from migration 014) still present in `pg_indexes`.
- [ ] Post-failure negative assertions: `users.role` column does NOT exist in `information_schema.columns`; `ux_users_email_lower` index does NOT exist; `invites` and `audit_log` tables do NOT exist in `information_schema.tables`.

### G. Verification

- [ ] `npm run test:integration:full:host` — new admin-cli file passes + migration-030 case passes.
- [ ] `npm run typecheck` — CLI refactor compiles cleanly.
- [ ] `npx eslint .` — no new lint warnings.
- [ ] Full test suite per `full-test-suite.md` before PR: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.

## Open Items

None. No debate triggered; all decisions resolved in Phase 1 grill.

## Out of Scope (explicit)

- No schema change to `invites` (no unique-on-email index). Re-issuing invites stays operator-allowed.
- No change to `promoteUserToAdminByEmail` audit-emission semantics. Double-emit on already-admin re-run is pinned as observed behavior.
- No memory-backed sibling test blocks. CLIs are operational Postgres tools.
- No shell subprocess spawn harness. In-process `main(argv)` covers the same surface.
- No new CLI flags (demote, revoke-invite, re-issue-invite).
- No CI changes. New tests slot into the existing `test:integration:full:host` target.

## References

- Parent scope-todo (KZO-143): `docs/004-notes/kzo-143/scope-todo-202604151530-foundations.md`
- Linear: https://linear.app/kzokv/issue/KZO-153
- No debate note written — resolved entirely in Phase 1 grill.
- Related rules: `integration-test-persistence-direct.md`, `test-placement-persistence-backend.md`, `vitest-config-patterns.md`, `migration-strategy.md`.
