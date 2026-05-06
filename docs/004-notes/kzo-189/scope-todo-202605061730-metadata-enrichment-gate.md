---
slug: kzo-189
source: scope-grill
created: 2026-05-06
tickets: [KZO-189]
required_reading:
  - docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md
  - apps/api/src/services/market-data/backfillWorker.ts
  - apps/api/src/services/market-data/repairCooldown.ts
  - apps/api/src/routes/adminRoutes.ts
superseded_by: null
---

# Todo: KZO-189 — AU metadata enrichment: trigger gate + admin-configurable mode

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The KZO-172 transition note is the design parent; the locked design touches a paragraph at line ~237 that needs replacement.

## Locked Decisions (from scope-grill, 2026-05-06)

1. **Predicate.** `shouldEnrich = (mode === "unconditional") || (trigger !== "daily_refresh")`. Skip case is exactly one trigger: `daily_refresh`. ALLOW = `{user_selection, first_trade, retry, repair}`.
2. **`reserveCapacity` formula.** Replace flat `reserveCapacity(3)` with `reserveCapacity(2 + (shouldEnrich ? 1 : 0))`. KZO-190 retains narrower scope (`includeBars`/`includeDividends` count cleanup).
3. **Configuration model.** Hybrid: env var `METADATA_ENRICHMENT_MODE=unconditional|conditional` (default `conditional`) + `app_config.metadata_enrichment_mode TEXT NULL` column. DB override wins; null → fall back to env. Mirrors `repairCooldownMinutes` precedent exactly.
4. **Storage shape.** String enum (`"unconditional"` | `"conditional"`). Read every job (no in-process cache). No TTL semantics.
5. **Admin UI.** Three-option select in `AdminSettingsClient.tsx` after the cooldown block. Audited via existing `app_config_updated` action.
6. **Toggle behavior.** Passive — mode change applies to future backfill jobs only. No one-shot enrichment sweep on save.
7. **Worker injection.** `getEffectiveMetadataEnrichmentMode` injected as a functor in `BackfillWorkerDeps` (mirror `getUsersMonitoringTicker` shape). New service module `apps/api/src/services/market-data/metadataEnrichmentMode.ts` mirroring `repairCooldown.ts`.
8. **Out of scope.** Per-ticker freshness TTL; active sweep on toggle; `includeBars`/`includeDividends`-aware `reserveCapacity` math (KZO-190); the backlog gating in the original ticket text.

### Truth table (for implementer + reviewer reference)

| `mode` | `trigger` | `shouldEnrich` | `reserveCapacity` |
|---|---|---|---|
| `unconditional` | any | `true` | 3 |
| `conditional` | `user_selection` / `first_trade` / `retry` / `repair` | `true` | 3 |
| `conditional` | `daily_refresh` | **`false`** | **2** |

`unconditional` mode preserves pre-KZO-189 behavior exactly — clean rollback lever.

---

## Implementation Steps

### Phase 1 — Backend + Frontend (parallel: Implementer + QA, Tier 2)

**Implementer scope (source code + implementation-coupled test updates):**

- [ ] **1. DB migration.** New sequential file under `db/migrations/`, e.g. `NNN_app_config_metadata_enrichment_mode.sql`:
  - `ALTER TABLE app_config ADD COLUMN metadata_enrichment_mode TEXT NULL;`
  - `ALTER TABLE app_config ADD CONSTRAINT chk_metadata_enrichment_mode CHECK (metadata_enrichment_mode IS NULL OR metadata_enrichment_mode IN ('unconditional', 'conditional'));`
  - **Rule:** `migration-strategy.md` — default to a NEW sequential file; do NOT in-place edit any prior `app_config`-touching migration (immutable once applied to any environment).

- [ ] **2. Env config.** `libs/config/src/env.ts` — add `METADATA_ENRICHMENT_MODE: z.enum(["unconditional", "conditional"]).default("conditional")` to the env schema. Update env-setup CLI prompts and `.env.example`. Rebuild `@tw-portfolio/config`.

- [ ] **3. Persistence interface + impls.**
  - `apps/api/src/persistence/types.ts`: add `getMetadataEnrichmentMode()` / `setMetadataEnrichmentMode(mode: "unconditional" | "conditional" | null)` methods. Extend the `AppConfigSnapshot` shape returned by `getAppConfig()` to include `metadataEnrichmentMode: "unconditional" | "conditional" | null`.
  - `apps/api/src/persistence/memory.ts`: implement, default null.
  - `apps/api/src/persistence/postgres.ts`: implement via `app_config` table.
  - **Rule:** `interface-caller-verification.md` — grep for both new method names after implementation; verify each has at least one caller (admin route + worker resolver).

- [ ] **4. Service module.** New `apps/api/src/services/market-data/metadataEnrichmentMode.ts` mirroring `repairCooldown.ts`:
  ```ts
  export async function getEffectiveMetadataEnrichmentMode(
    persistence: { getAppConfig(): Promise<AppConfigSnapshot> },
  ): Promise<"unconditional" | "conditional"> {
    const config = await persistence.getAppConfig();
    return config.metadataEnrichmentMode ?? Env.METADATA_ENRICHMENT_MODE;
  }
  ```

- [ ] **5. Shared-types DTO.** `libs/shared-types/src/dashboard.ts` (or wherever `AppConfigDto` lives) — add:
  - `metadataEnrichmentMode: "unconditional" | "conditional" | null`
  - `effectiveMetadataEnrichmentMode: "unconditional" | "conditional"`
  - **Rule:** `shared-types-barrel-turbopack.md` — these are type-only additions; if `libs/shared-types/src/index.ts` is currently type-only, no Turbopack risk. If first-time runtime export hazard, audit `export type *` siblings.

- [ ] **6. Admin route.** `apps/api/src/routes/adminRoutes.ts`:
  - Extend `patchAdminSettingsSchema` with `metadataEnrichmentMode: z.union([z.enum(["unconditional", "conditional"]), z.null()]).optional()`.
  - Extend `loadAppConfigDto` to populate both `metadataEnrichmentMode` and `effectiveMetadataEnrichmentMode`.
  - Add diff branch in PATCH handler (mirror the `repairCooldownMinutes` block at lines 365-372). Audit metadata key: `metadataEnrichmentMode`.

- [ ] **7. Backfill worker integration.** `apps/api/src/services/market-data/backfillWorker.ts`:
  - Add `getEffectiveMetadataEnrichmentMode: () => Promise<"unconditional" | "conditional">` to `BackfillWorkerDeps`.
  - Near the top of the handler (after Zod parse), compute:
    ```ts
    const mode = await getEffectiveMetadataEnrichmentMode();
    const shouldEnrich = mode === "unconditional" || trigger !== "daily_refresh";
    ```
  - Update `reserveCapacity(3)` → `reserveCapacity(2 + (shouldEnrich ? 1 : 0))`.
  - Wrap the metadata enrichment block (lines 222-252) in `if (shouldEnrich) { ... }`.
  - Update the comment block at lines 166-173 + 220-231 (remove the "every backfill" wording; reference the new gate + KZO-189).
  - **Critical pre-KZO-172 rule:** preserve the `RateLimitedError` re-throw inside the metadata catch (`.claude/rules/typed-transient-error-catch-audit.md`).

- [ ] **8. Worker construction.** `apps/api/src/server.ts` (or wherever `createBackfillHandler(deps)` is called) — wire the new functor: `getEffectiveMetadataEnrichmentMode: () => getEffectiveMetadataEnrichmentMode(app.persistence)`.

- [ ] **9. Update test mocks (implementation-coupled).** `apps/api/test/unit/backfill-handler-branching.test.ts` `createDeps()` and `createAuDeps()` — add `getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional")`. Existing assertions remain valid because all existing tests use ALLOW-list triggers.

- [ ] **10. Admin UI.** `apps/web/components/admin/AdminSettingsClient.tsx`:
  - Add state for `metadataEnrichmentMode` field.
  - Add three-option select after the cooldown block:
    - "Use environment default ({effectiveMetadataEnrichmentMode})"
    - "Always enrich (unconditional)"
    - "Skip on daily refresh (conditional)"
  - PATCH handler: send `metadataEnrichmentMode` field; success/error toast follows existing pattern.
  - Render the effective value alongside the override (mirror cooldown UI).

**QA scope (new tests / behavioral coverage):**

- [ ] **11. Unit tests (vitest).** `apps/api/test/unit/backfill-handler-branching.test.ts` — add 4 new cases:
  - `unconditional` × `daily_refresh` → enriches, `reserveCapacity(3)`
  - `conditional` × `daily_refresh` → skips, `reserveCapacity(2)`, `fetchInstrumentMetadata` NOT called
  - `conditional` × `user_selection` → enriches, `reserveCapacity(3)` (sanity)
  - `conditional` × `repair` → enriches, `reserveCapacity(3)` (regression guard for the locked allowlist)
  - **Rule:** `vitest-config-patterns.md` — if any test mocks `Env.METADATA_ENRICHMENT_MODE`, replace closure-method accessors too.

- [ ] **12. Admin settings integration test.** `apps/api/test/integration/` — PATCH `/admin/settings` with `metadataEnrichmentMode` set to each of `"unconditional"` / `"conditional"` / `null`; verify DTO read-back, `app_config` row state, and audit log entry shape (action `app_config_updated`, before/after metadata).
  - **Rule:** `integration-test-persistence-direct.md` — use `PostgresPersistence` directly, not `buildApp({ persistenceBackend: "postgres" })`.
  - Seed real admin actor user (FK constraint on `audit_log.actor_user_id`).

- [ ] **13. Web unit test.** `apps/web/components/admin/__tests__/AdminSettingsClient.test.tsx` (or equivalent) — render the select; simulate change; verify PATCH body shape; verify effective-value rendering.

- [ ] **14. E2E AAA test (admin OAuth path).** `apps/web/tests/e2e/specs-oauth/admin-metadata-enrichment-mode-aaa.spec.ts`:
  - Admin user logs in, navigates to `/admin/settings`, changes the metadata enrichment mode select, saves, observes audit log entry.
  - **Rule:** `playwright-page-object-testid-drift.md` — any new `data-testid` in `AdminSettingsClient.tsx` must have a matching locator in the page object, and vice versa. Run the grep recipe before submitting.
  - **Rule:** `e2e-oauth-seed-as-browser.md` — admin pages are OAuth-only; use `seedAsBrowser` pattern if seeding test prefs.

- [ ] **15. HTTP AAA spec.** `apps/api/test/http/specs/admin-settings-aaa.http.spec.ts` (or extend existing) — assert the PATCH validation paths:
  - Valid `metadataEnrichmentMode` value → 200 + DTO updated
  - Invalid value (e.g., `"foo"`) → 400 with `error: "validation_error"` (read `body.error`, not `body.code` per `service-error-pattern.md`)
  - Non-admin user → 403
  - **Rule:** `test-api-mapper-registration.md` — if extending an endpoint surface, verify `libs/test-api/src/config/mapper.ts` is updated.

- [ ] **16. Verify existing tests still pass.** `auStockBackfill.integration.test.ts` (uses `user_selection`) should be unchanged. Existing daily_refresh unit tests should be unchanged (their assertions don't touch `reserveCapacity` count).

### Phase 2 — Code Review + Docs (sequential)

- [ ] **17. Code review.** Run `/code-reviewer` against the worktree. Verify:
  - All carry-forward rule applications listed below
  - Per-method caller grep for the 2 new persistence methods
  - Audit log shape matches existing `app_config_updated` precedent
  - `RateLimitedError` re-throw preserved in the metadata catch
  - Mode predicate truth-table matches all 3 lock-table rows above
  - **Rule:** `code-review-before-pr.md` — this ticket touches 10+ files, qualifies for structured review.

- [ ] **18. Transition note.** New `docs/004-notes/kzo-189/transition-{datetime}-metadata-enrichment-gate.md`:
  - Problem / Solution / Testing (with Evidence: block) / Risk-Rollback sections per `pr-bound-docs-review-compliance.md`
  - Quote the truth table above verbatim
  - Document the audit signal name + how to query it

- [ ] **19. KZO-172 transition note correction.** `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md` line ~237 — replace the "feature flag avoids touching the worker's core logic" paragraph with a pointer to the implemented design in KZO-189's transition note. Acknowledge that the implemented gate touches the worker. **Rule:** `doc-stale-forward-notes.md` — replace in place; do not append.

- [ ] **20. Runbook update.** `docs/002-operations/runbook.md` — add operational entry:
  - Where the setting lives (admin settings page + env var)
  - When to flip it (Yahoo budget pressure signal: frequent `backfill_rate_limited` warnings)
  - How to audit a change (filter audit log by action `app_config_updated`, look at `metadata.before/after.metadataEnrichmentMode`)
  - **Rule:** `doc-stale-forward-notes.md` — grep first for any KZO-172 "future candidate" lines about metadata enrichment that this PR fulfills.

- [ ] **21. `.env.example` update.** Add the new env var entry with comment describing the two valid values and the default.

### Phase 3 — Validator (full 8-suite gate)

- [ ] **22. Full pre-push gate.** Per `full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
  - Suite 5 (`test:integration:full:host`) — Postgres-backed; new admin settings integration test must pass against real DB.
  - Suite 7 (`test:e2e:oauth:mem`) — admin metadata-enrichment-mode E2E spec.
  - Suite 8 (`test:http`) — admin-settings HTTP-AAA spec.
  - **Rule:** `validator-process-hygiene.md` — kill any spawned dev servers before reporting `[DONE]`.
  - **Rule:** `playwright-web-bundle-rebuild.md` — if iterating on a single E2E spec, rebuild `apps/web` between source edits.

### Phase 4 — Memory curation + PR

- [ ] **23. Memory curation.** Architect or Memory Curator runs `/si:review` if any rules need updating. Notably:
  - The KZO-172 transition note's "feature flag avoids touching worker logic" claim is being contradicted — that's a doc fix, not a memory entry.
  - If implementation reveals any new patterns (e.g. a non-obvious admin-settings test pattern), capture via `/si:remember`.

- [ ] **24. PR creation.** Per `git-pr-flow.md` and `commit-format.md`:
  - Commit format: `feat(api,web,db): KZO-189: gate AU metadata enrichment on trigger; admin-configurable mode`
  - PR body MUST have `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` per `pr-bound-docs-review-compliance.md`.
  - PR description references both transition notes.

---

## Open Items

None from this scope-grill. Two follow-ups already tracked separately:

- **KZO-190** — `reserveCapacity` cleanup for `includeBars`/`includeDividends`-aware count math. Existing ticket; unblocked by this work but no new dependency.
- **TTL-aware enrichment** — explicitly out of scope. No ticket needed unless ops surfaces a concrete need.

---

## Carry-Forward Rule Warnings (apply at implementation time)

- `migration-strategy.md` — new sequential migration file for the `app_config` column; do not in-place edit prior migrations.
- `interface-caller-verification.md` — grep for the 2 new persistence method names; verify each has at least one caller.
- `service-error-pattern.md` — PATCH validation errors thrown via `routeError(400, "validation_error", ...)` (zod handles this).
- `shared-types-barrel-turbopack.md` — DTO additions are type-only; audit `libs/shared-types/src/index.ts` for first-time runtime export hazard before build.
- `code-review-before-pr.md` — 10+ files, 4 layers; structured review is mandatory.
- `vitest-config-patterns.md` — if mocking `Env`, replace `Env.get*()` method closures alongside scalar fields.
- `agent-team-workflow.md` — Tier 2 (Squad) is the right tier; Implementer + QA in parallel; Phase 3 [GO] gate.
- `validator-activation-gate.md` — Validator only runs on explicit `[GO]`; not on TaskList flips.
- `validator-process-hygiene.md` — kill spawned processes before `[DONE]`; pre-shutdown `lsof` sweep.
- `e2e-aaa-guardrails.md` + `playwright-page-object-testid-drift.md` — testid coverage check on new locators.
- `e2e-oauth-seed-as-browser.md` — admin pages are OAuth; use `seedAsBrowser` pattern.
- `playwright-page-object-testid-drift.md` — single-locator grep recipe before submitting any new page-object additions.
- `pr-bound-docs-review-compliance.md` — PR description must satisfy `pr-gate.yml` body validation (Problem / Solution / Testing+Evidence / Risk-Rollback sections).
- `typed-transient-error-catch-audit.md` — preserve the `RateLimitedError` re-throw in the metadata catch when wrapping the block in `if (shouldEnrich)`.
- `commit-format.md` — `feat(scope): KZO-189: ...` with Co-Authored-By trailer.
- `full-test-suite.md` — all 8 suites green via `test:all:full` + lint + typecheck.

---

## References

- **Linear ticket:** [KZO-189](https://linear.app/kzokv/issue/KZO-189/au-metadata-enrichment-gate-on-triggeruser-selection-yahoo-budget)
- **Related tickets:** KZO-172 (parent — unconditional baseline), KZO-188 (sibling — AU ticker discovery), KZO-190 (follow-up — `reserveCapacity` cleanup)
- **Design parent:** `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md` (the paragraph at line ~237 to be corrected)
- **Worker source:** `apps/api/src/services/market-data/backfillWorker.ts` (lines 166-252 are the touch zone)
- **Precedent — admin settings hybrid pattern:** `apps/api/src/services/market-data/repairCooldown.ts` + `adminRoutes.ts:46-95, 345-403`
