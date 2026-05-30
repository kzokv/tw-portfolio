---
slug: kzo-149
source: scope-grill
created: 2026-04-19
tickets: [KZO-149]
required_reading: []
superseded_by: null
---

# Todo: KZO-149 — Extend hard-purge cascade to portfolio_shares + anonymous_share_tokens

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Read `AGENTS.md` before any git commit or PR operation.

## Key findings from scope grill

- `portfolio_shares` cascade in `memory.ts` is **already implemented** (lines 2262–2272, added in KZO-146). No memory.ts change needed for it.
- Only `anonymous_share_tokens` is missing from `hardPurgeUser`.
- `anonymousShareTokenLocks` Map also needs cleanup (stale entry after purge).
- `listSharesForOwner(purgedId)` and `listInboundSharesForGrantee(purgedId)` both **throw 404** after purge — assert from the surviving user's perspective instead.
- `listAnonymousShareTokensForOwner` does not throw on missing owner — but use `findActiveAnonymousShareTokenByToken(token)` for cleaner assertions (no time-window filter ambiguity).
- The "revoker purged → SET NULL" scenario was **dropped**: `revokedByUserId` is always the owner (enforced by `revokeShareGrant`), so owner purge always triggers CASCADE DELETE — the SET NULL path is unreachable through the business API.
- Postgres `ON DELETE CASCADE` is already correct in both migrations — no DB change needed.
- The existing "hard-purge cascade" describe block in `admin-management.integration.test.ts` runs on memory backend. The Postgres cascade test is new, not an extension.

## Implementation Steps

- [ ] **`apps/api/src/persistence/memory.ts` — `hardPurgeUser`**: add `this.anonymousShareTokenLocks.delete(userId)` after the user is confirmed to exist (before or after the shares loop, but before the final `usersByEmail.delete`)
- [ ] **`apps/api/src/persistence/memory.ts` — `hardPurgeUser`**: add backwards-splice loop deleting `anonymousShareTokens` rows where `ownerUserId === userId` (mirror the existing `portfolioShares` loop pattern)
- [ ] **`apps/api/test/unit/admin-user-management.test.ts`** — add 3 cases to `"hardPurgeUser — memory backend"` describe:
  - `portfolioShares`: owner purged → row deleted (Arrange: create owner + grantee + share; Act: purge owner; Assert: `listInboundSharesForGrantee(granteeId)` returns `{ active: [], revoked: [] }`)
  - `portfolioShares`: grantee purged → row deleted (Arrange: create owner + grantee + share; Act: purge grantee; Assert: `listSharesForOwner(ownerId)` active + revoked both empty)
  - `anonymousShareTokens`: owner purged → row deleted (Arrange: create owner + token with future `expiresAt`; Act: purge owner; Assert: `findActiveAnonymousShareTokenByToken(token)` returns null)
- [ ] **`apps/api/test/integration/admin-management.integration.test.ts`** — add `describePostgres` guard (following the pattern in `catalogSync.integration.test.ts` / `user-identity.integration.test.ts`) and 3 Postgres cascade cases calling `app.persistence.hardPurgeUser()` directly with `persistenceBackend: "postgres"`:
  - `portfolio_shares` owner purged → CASCADE delete (assert via `listInboundSharesForGrantee(survivingGranteeId)`)
  - `portfolio_shares` grantee purged → CASCADE delete (assert via `listSharesForOwner(survivingOwnerId)`)
  - `anonymous_share_tokens` owner purged → CASCADE delete (assert via `findActiveAnonymousShareTokenByToken(token)`)
- [ ] Run `npm run test --prefix apps/api` (suite 4) — all memory-backed tests green
- [ ] Run `npm run test:integration:full:host` (suite 5) — Postgres cascade tests green (requires local Postgres stack)
- [ ] Run `npx eslint .` and `npm run typecheck` — clean

## Out of Scope

- HTTP route re-testing (already covered by existing memory-backed tests)
- Revoker SET NULL scenario (dead code path — `revokedByUserId` is always `ownerUserId`)
- New migrations (both tables already have correct `ON DELETE CASCADE`)
- New test files (Postgres cascade test goes inline in `admin-management.integration.test.ts`)

## References

- Linear: https://linear.app/kzokv/issue/KZO-149
- `hardPurgeUser` impl: `apps/api/src/persistence/memory.ts:2226`
- Existing cascade tests: `apps/api/test/integration/admin-management.integration.test.ts:123`
- `describePostgres` pattern: `apps/api/test/integration/catalogSync.integration.test.ts:23`
- FIXME comment for Postgres tests: `apps/api/test/integration/admin-management.integration.test.ts:308`
- Scope decision origin: `docs/004-notes/kzo-144/scope-todo-202604170218-admin-portal.md` (Decision #2)
