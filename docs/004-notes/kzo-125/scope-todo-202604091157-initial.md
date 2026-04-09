---
slug: kzo-125
source: scope-grill
created: 2026-04-09
tickets: [KZO-125]
required_reading: []
superseded_by: null
---

# Todo: KZO-125 — GET /profile 404 on dev_bypass + memory backend

> **For agents starting a fresh session:** this scope was locked via scope-grill on 2026-04-09. The ticket's original framing was corrected during the session — see "Corrected problem statement" below before reading the Linear ticket.

## Corrected problem statement

The ticket claims `GET /profile` returns 404 as an "expected state for new users" and proposes changing both `memory.ts` and `postgres.ts` to return a default profile DTO. **This framing is wrong.**

Reality:
- There is no separate "profile" table. Profile data lives on `users` + `user_external_identities` rows.
- `getProfile()` only 404s when the `userId` has no `users` row at all.
- **`PostgresPersistence.seedDefaults()` already auto-seeds `user-1`** via `ensureDefaultPortfolioData` (`apps/api/src/persistence/postgres.ts:1630` → `:127-135`). The 404 cannot fire for `user-1` on Postgres.
- **The bug is memory-only:** `MemoryPersistence.init()` does not seed any user. In dev_bypass mode, `resolveUserId` returns `"user-1"` as the hardcoded default, and `getProfile("user-1")` hits an empty `usersByEmail` map → 404.
- In Postgres production, a `getProfile` 404 would only fire on (a) broken `seedDefaults`, (b) a deleted user row, or (c) an auth layer issuing an invalid userId — all loud signals we want to keep visible, not mask with a phantom DTO.

Conclusion: fix only `MemoryPersistence`. Do not touch `postgres.ts`.

## Implementation Steps

- [ ] **1. `apps/api/src/persistence/memory.ts`** — extend `MemoryPersistenceOptions` with `seedDevBypassUser?: boolean`. In `init()`, when the flag is `true`, insert a `MemoryUser` into `usersByEmail` with:
  - `id: "user-1"` (matches the dev_bypass default from `routes/registerRoutes.ts:197`)
  - `email: "user-1@placeholder.local"` (mirrors the placeholder pattern in `postgres.ts:134`)
  - `providerSubject: "dev-bypass"`
  - `displayName: null`, `providerDisplayName: null`, `providerPictureUrl: null`

- [ ] **2. `apps/api/src/persistence/index.ts`** — extend `PersistenceFactoryOptions` with `seedDevBypassUser?: boolean` and pass it through to the `MemoryPersistence` constructor.

- [ ] **3. `apps/api/src/app.ts`** — in `buildApp()`, alongside the existing `seedMemoryCatalog` computation (around line 69), compute:
  ```ts
  const seedDevBypassUser = persistenceBackend === "memory" && Env.AUTH_MODE === "dev_bypass";
  ```
  Pass it into `createPersistence(persistenceBackend, { seedMemoryCatalog, seedDevBypassUser })`. This co-locates env-dependent flag reads in one file and is consistent with the existing pattern. `Env.AUTH_MODE` is read at call time so `vi.mock("@tw-portfolio/config")` in tests continues to work.

- [ ] **4. `apps/api/test/unit/memory-profile.test.ts`** — **ADD** a new test (do NOT modify existing tests). Existing tests use `"non-existent-id"` and direct construction without the flag, so they remain green. New test:
  ```ts
  it("getProfile returns seeded user-1 when seedDevBypassUser is enabled", async () => {
    const seeded = new MemoryPersistence({ seedDevBypassUser: true });
    await seeded.init();
    const profile = await seeded.getProfile("user-1");
    expect(profile.userId).toBe("user-1");
    expect(profile.email).toBe("user-1@placeholder.local");
    expect(profile.displayName).toBeNull();
    expect(profile.providerPictureUrl).toBeNull();
    expect(profile.providerDisplayName).toBeNull();
    expect(profile.linkedAt).toBeNull();
    expect(profile.lastSeenAt).toBeNull();
  });
  ```

- [ ] **5. `apps/web/features/profile/hooks/useProfile.ts`** — remove unused `error` and `isLoading` state and return-shape fields. The only caller (`AppShell.tsx:160`) reads only `profile` and `refresh`. Keep the internal try/catch so fetch failures are swallowed silently (same effective behavior as today, since no UI renders the `error` field). Resulting hook returns `{ profile, refresh }`.

  Framing note for PR description: this is **hygiene dead-code removal**, NOT a functional dependency on the server-side fix. The ticket's "simplify error handling once 404 is eliminated" bullet was a misread — the hook never had 404-specific handling. The server-side fix alone eliminates the browser console 404 noise.

## Verification Plan (full seven suites per `full-test-suite.md`)

- [ ] `npx eslint .`
- [ ] `npm run typecheck`
- [ ] `npm run test --prefix apps/web`
- [ ] `npm run test:integration:full:host`
- [ ] `npm run test:e2e:bypass:mem --prefix apps/web` — includes the dev_bypass suite that previously triggered the console 404
- [ ] `npm run test:e2e:oauth:mem --prefix apps/web` — verify `profile-tab-aaa.spec.ts` still passes (flag is off in oauth mode)
- [ ] `npm run test:http --prefix apps/api` — verify `profile-api-aaa.http.spec.ts` still passes (runs AUTH_MODE=oauth)
- [ ] Manual smoke: `AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory API_PORT=4000 npm run dev --prefix apps/api`, then `curl http://127.0.0.1:4000/profile` → expect HTTP 200 with seeded DTO (was 404 before the fix)

## Explicitly out of scope (disagreements resolved during grill)

- `apps/api/src/persistence/postgres.ts` — unchanged. Postgres already seeds `user-1`; returning phantom profiles would degrade observability of production auth bugs.
- Updating `memory-profile.test.ts:30-32` ("throws for non-existent userId") — the existing assertion uses `"non-existent-id"` and direct construction without the flag, so it remains correct without modification.
- 401 handling / redirect-to-login inside `useProfile` — pre-existing concern, scope creep.
- Differentiating "no profile yet" from "real error" in the hook — after the fix, the "no profile yet" state does not exist.
- Changes to `apps/web/app/api/profile/route.ts` — the route already delegates to `persistence.getProfile`; no web-layer change is needed.

## Behavioral change to document in PR

In dev_bypass + memory mode, `SettingsDrawer` → `ProfileSection` previously rendered `{loadingSettings}` text indefinitely because `profile` stayed `null` (the 404 path). After this fix, it renders the actual profile form with `displayName = null` and `email = "user-1@placeholder.local"`. This is a silent UX improvement (the drawer was effectively broken in dev_bypass). No E2E test asserts on the old "loading..." state, so no test updates are needed — but mention it in the PR description for reviewers.

## Open Items

None.

## References

- Linear ticket: KZO-125 (https://linear.app/kzokv/issue/KZO-125)
- Related codebase anchors:
  - `apps/api/src/persistence/memory.ts:85-89` (`init`), `:216-230` (`getProfile`)
  - `apps/api/src/persistence/postgres.ts:127-135` (placeholder user pattern), `:1630` (auto-seed call)
  - `apps/api/src/app.ts:68-70` (existing flag pattern in `buildApp`)
  - `apps/api/src/routes/registerRoutes.ts:197` (dev_bypass `user-1` default)
  - `apps/web/features/profile/hooks/useProfile.ts` (dead-code trim target)
  - `apps/web/components/layout/AppShell.tsx:160,272-274,466-467` (sole consumer of `useProfile`)
- Project rules consulted: `.claude/rules/full-test-suite.md`, `.claude/rules/vitest-config-patterns.md`, `.claude/rules/migration-strategy.md` (no migration needed — this is a pure code change), `.claude/rules/doc-management.md` (frozen-snapshot naming)
