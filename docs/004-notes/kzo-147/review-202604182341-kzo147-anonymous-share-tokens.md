---
slug: kzo-147
source: code-review
created: 2026-04-18
tickets: [KZO-147]
scope_ref: docs/004-notes/kzo-147/scope-todo-202604181855-anonymous-share-tokens.md
verdict: approve-with-suggestions
score: 88
---

# Code review — KZO-147 anonymous share tokens

Review of the full implementation (~6.4k insertions, 81 files) against `dev@78824b6`.
Branch: `worktree-kzo-147`. All eight test suites green at review time.

## Scope covered

- API surface + guards (`apps/api/src/routes/registerRoutes.ts`)
- Persistence contracts (`apps/api/src/persistence/{types,memory,postgres}.ts`)
- Public SSR page + security headers (`apps/web/app/share/[token]/`, `next.config.mjs`)
- Owner Section C components (`apps/web/components/sharing/{PublicLinksSection,AnonymousLinksTable,CreateAnonymousLinkDialog,RevokeAnonymousLinkDialog}.tsx`)
- Migration 033
- Recent test-green fixes (raw `expect()` removal, dialog testId consolidation, ticker-name hygiene, integration cascade, `workers: 1` for HTTP)

## Verdict

**Approve with suggestions.** The implementation matches the locked scope decisively:
dedicated `PublicShareViewDto` with type-level cost-basis exclusion, pure-SSR `/share/[token]`,
owner Section C on `/sharing`, 22-char base62 tokens, 30/5-min per-IP rate limit (counts
invalids), 20-active-per-owner cap with advisory-lock race safety, and the full
10 HTTP + 5 UI + 1 integration AAA coverage. Findings below are cleanup / low-risk
follow-ups — none block merge.

## Findings

### P2 (Medium) — address before or shortly after merge

#### M1. Redundant clause in `listAnonymousShareTokensForOwner` retention filter
`apps/api/src/persistence/postgres.ts:1532-1536`

```sql
WHERE owner_user_id = $1
  AND (
    (revoked_at IS NULL AND expires_at > NOW())        -- clause A (active)
    OR (revoked_at IS NULL AND expires_at > $2::timestamptz) -- clause B
    OR (revoked_at IS NOT NULL AND revoked_at > $2::timestamptz)
  )
```

`$2` is `NOW() - 30d`, so clause A (expires_at > NOW()) is a strict subset of
clause B (expires_at > NOW() - 30d). Clause A can be dropped:

```sql
(revoked_at IS NULL AND expires_at > $2::timestamptz)
OR (revoked_at IS NOT NULL AND revoked_at > $2::timestamptz)
```

Correctness: identical. Cost: shaves one branch from the planner. Low priority.

#### M2. `routeError` thrown from persistence layer
`apps/api/src/persistence/memory.ts:767`, `apps/api/src/persistence/postgres.ts:1442`

```ts
if (!owner) {
  throw routeError(404, "user_not_found", "User not found");
}
```

`routeError` is an HTTP-layer helper (`apps/api/src/lib/routeError.ts`). Throwing it
from persistence couples the persistence package to HTTP semantics — the route handler
never distinguishes this 404 from the `token_not_found` contract. Cleaner options:

- Return `{ status: "owner_not_found" }` and let the route translate to 404, **or**
- Drop the check — any owner in this codepath came from a verified session, so the
  row existence is a DB-integrity invariant, not a client-facing error.

Practical risk: low. The check is defensive and shouldn't fire for authenticated owners.
Pattern risk: future maintainers may extend this pattern into other persistence methods.

### P3 (Low) — nice-to-have cleanup

#### L1. Per-user mutex map never evicted
`apps/api/src/persistence/memory.ts:226, 755`

```ts
private readonly anonymousShareTokenLocks = new Map<string, Promise<unknown>>();
// ...
this.anonymousShareTokenLocks.set(input.ownerUserId, next.catch(() => undefined));
```

Each unique owner that ever calls `createAnonymousShareToken` adds one entry; it is
never removed. Memory persistence is dev/test only, so this is bounded by test-user
count and negligible in practice. Could be evicted when the chained promise resolves,
but not worth the complexity.

#### L2. Scope-todo divergence: inline role guards vs route-key sets
`apps/api/src/routes/registerRoutes.ts:1696-1697, 1748-1749`

Scope Q6 specified adding `POST /share-tokens` and `DELETE /share-tokens/:id` to
`WRITER_ROLE_ROUTE_KEYS` and `WRITE_CONTEXT_GUARD_ROUTE_KEYS`. The implementation
instead calls `requireShareGrantorRole(req)` + `requireWriteableContext(req)` inline:

```ts
app.post("/share-tokens", async (req, reply) => {
  requireShareGrantorRole(req);
  requireWriteableContext(req);
  // ...
});
```

Functionally equivalent (actually stricter, because `requireShareGrantorRole` blocks
demo in addition to viewer, where `WRITER_ROLE_ROUTE_KEYS` would have allowed demo
through). This matches the existing KZO-145 `/shares` pattern. **Not a regression**,
just a consistency note — the two enforcement styles now co-exist in the file. If a
future refactor ever moves to a fully table-driven guard dispatch, these inline
calls would need to be ported in.

#### L3. `ACTIVE_CAP` duplicated on client vs server
`apps/web/components/sharing/PublicLinksSection.tsx:22` (`const ACTIVE_CAP = 20;`)
vs `apps/api/src/lib/anonymousShareToken.ts:26` (`export const ANONYMOUS_SHARE_TOKEN_CAP = 20;`)

The client uses the constant for disabled-button + cap-banner display. If the cap is
ever changed on the server, the client drifts until recompiled. Options:
- Plumb the value through an env endpoint or a `/features` response
- Accept the drift (cap is unlikely to change often)

Low priority — the server still enforces the cap authoritatively via 429.

#### L4. `workers: 1` for HTTP suite trades speed for isolation
`apps/api/test/http/playwright.config.ts:15-18`

Added to eliminate cross-file contamination of the per-IP rate-limit bucket during
`anon-public-view-rate-limit-aaa.http.spec.ts`. Suite time went from ~13s to ~12s
(measured), so impact is negligible today. If the HTTP suite grows, alternatives:
- Enable Fastify `trustProxy` and have each test send a unique `X-Forwarded-For`
  to get its own bucket (requires production config change → security review).
- Split just the rate-limit spec into its own Playwright project with `workers: 1`.

Acceptable as-is; the comment documents the tradeoff.

### P4 (Informational) — observations, no change requested

#### I1. Token generator has no hard upper bound on iterations
`apps/api/src/lib/anonymousShareToken.ts:11-20`

`generateAnonymousShareToken` uses rejection sampling with ~3% rejection rate. The
outer `while (out.length < TOKEN_LENGTH)` loop is probabilistically bounded but not
hard-capped. In practice the probability of needing a 3rd randomBytes call is
~(0.03)^44 ≈ 10^-65. Acceptable — a hard cap would be dead code.

#### I2. `roundTo2` floating-point drift
`apps/api/src/services/publicShareView.ts:14-16`

`Math.round(value * 100) / 100` suffers the usual IEEE-754 edge cases for values
like 0.1 + 0.2. Per-currency totals over many holdings can drift by O(1¢) over
thousands of positions. Acceptable for a display DTO; not used for settlement.

#### I3. `domDoesNotContainCostBasis` regex is a weak net
`libs/test-e2e/src/assistants/sharing/AnonymousShareAssert.ts:85-89`

```ts
await expect(this.page.locator("body")).not.toContainText(/cost[\s-]?basis[\s:：]+[\d$NT]/i);
```

Wouldn't catch `"Cost basis £50,000"` (currency not in `[\d$NT]`) or separate
`"Cost basis"` + `"NT$50,071"` across DOM nodes. Fine because the primary defense
is type-level: `PublicShareViewDto.holdings` has no `costBasisAmount` field, so
the cost basis can't reach the DOM via this path. The DOM assertion is belt-and-suspenders
for renames/leaks. **Prefer: change the DTO field if cost-basis hygiene is ever
weakened, not tighten this regex.**

#### I4. `formatCurrencyAmount` / `formatDateLabel` trusted on public path
`apps/web/app/share/[token]/page.tsx:91, 64, 70`

These helpers in `apps/web/lib/utils` are reused from authenticated flows. Verify
they do not leak any server-side-only context when called from a public route
(e.g. locale resolution that touches `cookies()`). Spot-check only — the current
page does not pass any `cookies()`-derived data in. Log for future review if the
utils are extended.

## Positive observations

### Security

- **Rate limit before DB lookup** (`/share/:token`) — enumeration resistance works even
  if the DB is slow. Invalid tokens also count. Regex pre-check short-circuits before
  the rate-limiter increments? No — it increments first, exactly as scope requires.
- **Uniform 404 across all public-path failure modes** (expired / revoked / bad regex /
  deleted owner / deactivated owner). No existence oracle.
- **Log-path redaction** of the 22-char token via Fastify `req` serializer
  (`apps/api/src/app.ts:108`). Regex uses lookahead to avoid over-matching.
- **Security headers for `/share/:token*`** configured via `next.config.mjs` (Cache-Control,
  X-Frame-Options, Referrer-Policy). `dynamic = "force-dynamic"` + `robots: noindex` at
  the page level.
- **Server never sees auth on `/share/*`**: the SSR page does not call `cookies()` or
  forward any headers on its API fetch. Matches the MUST-NOT gates in scope Q2.
- **Token storage is plaintext by design** and documented; the PK (`id`) is used for
  revoke paths so the secret never appears in URLs for CRUD.

### Correctness

- **Race-safe cap check + insert** in postgres via `pg_advisory_xact_lock(hashtext(...))`
  inside the transaction (`postgres.ts:1431`). Memory backend mirrors the semantics via a
  per-user promise chain.
- **`status: "noop"`** in `revokeAnonymousShareToken` when token is already revoked or
  expired — prevents the "revoke resets retention clock" quirk and avoids duplicate audit.
- **Wrong-owner revoke returns 404** (not 403) — no existence leak.
- **`ON DELETE CASCADE` on `owner_user_id`** sets up KZO-149's hard-purge cascade as a
  no-op code change.
- **`ON DELETE SET NULL` on `revoked_by_user_id`** preserves audit history after user deletion.

### Test coverage

- 10 HTTP + 5 UI + 1 integration + 5 unit specs — matches scope Q7 exactly.
- Integration spec covers both required scenarios: concurrent-create race (exactly one
  of two 201/429 at cap=19) and `DELETE users → anonymous_share_tokens` cascade.
- Test-api mapper registration in place (`libs/test-api/src/config/mapper.ts:36`) — rule
  `test-api-mapper-registration.md` honoured.
- E2E seed endpoint uses `assertE2ESeedEnabled` (not `assertE2EResetEnabled`), so the API
  HTTP suite can mint tokens in `AUTH_MODE=oauth` — rule `e2e-seed-vs-reset-guards.md`
  honoured.

### Recent test-green fixes (specifically requested by the user)

| Fix | Assessment |
|---|---|
| Raw `expect()` → assert-helper methods (6 sites across 3 AAA specs) | Clean. Methods added to `SharingAssert` / `AnonymousShareAssert` are reusable (e.g. `firstPublicLinkRowIsVisible`) and correctly `@Step()`-annotated. |
| `RevokeAnonymousLinkDialog` testId consolidation (removed custom IDs) | Correct simplification. Two DOM elements with `data-testid="confirm-dialog"` now coexist; `confirmRevoke`/`revokePublicLink` correctly scope via `[data-testid="confirm-dialog"][open]` to the open `<dialog>`. `RevokeAnonymousLinkDialog.test.tsx` updated to match. |
| Ticker rename `2330/2454/0050 → 6770/5880/6669` (E2E + HTTP) | Addresses a real cross-test contamination of the global in-memory daily-bars array. Idempotency keys renamed to match. Comment added to the E2E spec explains the constraint. |
| Integration cascade — delete child rows before `DELETE FROM users` | Correct minimal fix. The test is specifically validating the `ON DELETE CASCADE` on `anonymous_share_tokens` — other child tables (fee_profiles, accounts, user_external_identities) are not CASCADE and must be cleared explicitly. Comment explains this. |
| `workers: 1` for HTTP playwright config | Pragmatic trade-off; comment documents the rationale. See L4. |
| `domDoesNotContainCostBasis` regex loosening | Correct — the original was a false-positive against the disclosure text "No cost basis". See I3 for a durability note. |
| Pre-existing ESLint warnings disabled via `// eslint-disable-next-line` on `dashboard-daily-change-aaa.spec.ts:94` and `dividend-calendar-aaa.spec.ts:193` | Both uses are legitimate (runtime weekend skip, runtime error guard). Inline disable with a narrow rule name is the right pattern. |

## Full-suite status at review time

| Suite | Result |
|---|---|
| 1. `npx eslint .` | clean |
| 2. `npm run typecheck` | clean |
| 3. web unit (vitest) | 241 passed |
| 4. API unit + memory integration | 603 passed, 127 skipped |
| 5. API integration (Postgres) | 377 passed, 3 skipped |
| 6. E2E bypass | 165 passed, 1 skipped |
| 7. E2E OAuth | 54 passed |
| 8. API HTTP | 86 passed |

## Action items (top-down)

1. **[P2 / M1] — FIXED IN THIS PR.** Dropped redundant clause A in
   `listAnonymousShareTokensForOwner` query (`postgres.ts:1532-1537`).
2. **[P2 / M2] — NOT FIXED (project-wide convention).** `routeError` throws from
   persistence appear in 7+ sites in `memory.ts` (lines 449, 500, 520, 573, 618, 669,
   691) predating KZO-147. Fixing only the KZO-147 sites would create inconsistency;
   a repo-wide refactor is outside this ticket's scope. Filed as a follow-up candidate.
3. **[P3 / L3] — NOT FIXED.** `ACTIVE_CAP` drift risk is low; server 429 is authoritative.
4. **[P3 / L4] — ACCEPTED.** `workers: 1` is documented with rationale; revisit if suite
   grows past ~60s.
5. **[I3]** No action; documented so future cost-basis-adjacent work knows the DTO type
   is the primary defense.

None of the above block the PR. M1 is landed; M2/L3/L4 are documented tradeoffs or
follow-up candidates.
