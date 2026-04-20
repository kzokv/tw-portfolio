---
slug: kzo-151
source: scope-grill
created: 2026-04-20
tickets: [KZO-151]
required_reading:
  - docs/004-notes/kzo-145/scope-todo-202604171530-share-grant-ui.md
  - docs/004-notes/kzo-146/scope-todo-202604181830-switcher-ux.md
  - .claude/rules/nextjs-i18n-serialization.md
  - .claude/rules/test-placement-persistence-backend.md
  - .claude/rules/integration-test-persistence-direct.md
superseded_by: null
---

# Todo: KZO-151 — Sharing notification zh-TW localization (scope-grill resolution)

> **For agents starting a fresh session:** read all files in `required_reading` before implementing. KZO-145 shipped the sharing-notification emit paths (English-only); KZO-146 shipped the frontend revoke-teardown handler that currently matches on English title. This ticket localizes the two server-side notification strings (grant + revoke) to zh-TW AND replaces the brittle title-match in `AppShell.tsx` with a locale-independent `detail.kind` discriminator.

Parent epic: KZO-141. Predecessors: KZO-145 (share grant UI — merged), KZO-146 (switcher UX — merged). Related: KZO-132 (daily_refresh notifications, explicitly out of scope — same class of issue, deferred to repo-wide pass).

## Locked Decisions

### Q1 — Notification locale source

**Recipient's `users.locale` at emit time.** No schema change. The column already exists (`users.locale TEXT NOT NULL DEFAULT 'en'` per `db/migrations/001_init.sql:4`), is user-controlled via `/settings` (validated as `z.enum(["en", "zh-TW"])` in `registerRoutes.ts:1826, 2110`), and is the same value the web UI uses. Notifications persist in the DB as plain text rendered once; device-consistency is automatic because the server owns rendering.

Rejected alternatives:
- `Accept-Language` from the triggering request — triggering request is the owner's, not the grantee's; wrong user.
- Fixed env `DEFAULT_LOCALE` — makes the feature useless for mixed-locale user bases.
- Snapshot `notifications.locale` column — migration for a debug-only field; rendered text is the same either way.
- Template-key + params (`title_key`, `body_key`, `params jsonb`) — retroactive re-render flexibility, but out of proportion for two strings; affects daily_refresh and future sources; breaks `NotificationDto.title: string` contract.

### Q2 — Frontend revoke-teardown matcher

**Refactor `AppShell.tsx:417` from `notification.title === "Portfolio access revoked"` to `notification.detail?.kind === "share_revoked"` in the same PR as the localization.**

The title-string match is a silent regression surface: any title localization (this ticket) would stop the auto-teardown behavior for zh-TW users. A stable discriminator in `detail` is locale-independent and future-proofs copy changes.

### Q3 — Strings file location

**Sibling file: `apps/api/src/persistence/shareNotificationStrings.ts`.**

```ts
export const shareNotificationStrings: Record<LocaleCode, {
  shareGranted: { title: string; body: string };          // body has {ownerLabel}
  shareRevoked: { title: string; body: string };
  anonymousOwnerFallback: string;                          // "Someone" / "某人"
}> = { en: {...}, "zh-TW": {...} };
```

All values are `{placeholder}` string templates per `nextjs-i18n-serialization.md` — **no function values**.

Rejected alternatives:
- Inline dictionaries inside `shareHelpers.ts` — pollutes the builder file with translations.
- Generic `apps/api/src/lib/i18n/notificationStrings.ts` — premature generalization; KZO-132 deferred, no second current user.
- Shared package (`libs/shared-types` or new `libs/i18n`) — web doesn't render these strings (API renders at emit time); zero benefit to web.

### Q4 — `detail.kind` discriminator shape

**`detail.kind: "share_granted" | "share_revoked"` on both notifications (symmetric).** Matches audit-log action values; greppable; unambiguous.

```ts
// Extended detail shape in shareHelpers.ts
detail: {
  kind: "share_granted" | "share_revoked";   // NEW
  ownerUserId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  shareId: string;
};
```

No `libs/shared-types` change — `NotificationDto.detail` is typed as `unknown`, shape is refined at emit/consume sites.

Rejected:
- Revoke-only `detail.kind` — asymmetric; future grant-side handler has no discriminator.
- Overload `sourceRef` with a prefix (`"granted:{shareId}"`) — overloaded semantic; fragile.
- No discriminator, match on field presence — brittle against schema drift.

### Q5 — Anonymous-owner fallback localization

**Localize `"Someone"` → `"某人"` (or translator-confirmed zh-TW).** Consumed when both `owner.displayName` and `owner.email` are null (effectively unreachable today since OAuth requires email, but touching the file anyway).

### Q6 — Test coverage

**Unit + Postgres integration + web matcher unit. No new E2E.**

| Layer | Test | Purpose |
|---|---|---|
| Unit (API) | `apps/api/test/unit/shareHelpers.test.ts` | Locale-string selection + `detail.kind` shape for both builders |
| Integration (Postgres) | `apps/api/test/integration/sharing-notification-locale.integration.test.ts` | Seed zh-TW grantee, trigger grant + revoke via persistence, assert stored `title` / `body` / `detail.kind` match zh-TW. Per `test-placement-persistence-backend.md`, locale-JOIN wiring is Postgres-specific. Use `PostgresPersistence` directly per `integration-test-persistence-direct.md`. |
| Unit (web) | Extend existing `useNotifications` / `AppShell` matcher test | Asserts on `detail.kind === "share_revoked"` rather than title |
| E2E | **None added** | Existing `sharing-revoke-confirm-and-notification-aaa.spec.ts` passes unchanged for en (default locale). zh-TW behavior follows by composition. |

Existing HTTP specs (`switcher-sse-revoke-event-aaa.http.spec.ts`, `sharing-revoke-active-aaa.http.spec.ts`, `switcher-narrow-taxonomy-aaa.http.spec.ts`, `sharing-revoke-confirm-and-notification-aaa.spec.ts`) need no changes — grantees default to `locale = "en"`, English assertions continue to pass.

---

## Gaps resolved during scope-grill (Phase 1.5)

- **G1 — Asymmetric locale storage between backends.** Postgres: locale on `users` table, folded into existing JOIN (`grantee.locale AS grantee_locale` — zero extra round-trip). Memory: locale lives on per-user `Store.settings.locale`, not `MemoryUser`; inline `this.stores.get(granteeUserId)?.settings.locale ?? "en"` at each call site. Rejected a unified `persistence.getUserLocale` helper — asymmetric cost, six inline reads are greppable.
- **G2 — `ShareUser` type stays narrow.** Owners don't receive these notifications. Add `granteeLocale: LocaleCode` as a separate param to both builders; don't extend `ShareUser`.
- **G3 — No shared-types churn.** `NotificationDto.detail: unknown` accepts the refined shape without DTO changes.
- **G4 — Pre-existing notifications without `detail.kind`.** Accept as known limitation — matcher fires on SSE push (real-time), not bell re-reads, so old rows render as text but don't trigger teardown (correct: those revocations already happened).

---

## Implementation Steps

### API — strings + builders

- [ ] Create `apps/api/src/persistence/shareNotificationStrings.ts` with `en` + `zh-TW` dictionaries. All values as `{placeholder}` templates — no function values. Keys: `shareGranted.{title,body}`, `shareRevoked.{title,body}`, `anonymousOwnerFallback`.
- [ ] Update `apps/api/src/persistence/shareHelpers.ts`:
  - [ ] Import `shareNotificationStrings` and `LocaleCode` (from `@tw-portfolio/shared-types`).
  - [ ] Add `granteeLocale: LocaleCode` as a required param to `buildShareGrantedNotification` and `buildShareRevokedNotification`.
  - [ ] Select strings via `shareNotificationStrings[granteeLocale] ?? shareNotificationStrings.en` (defensive fallback).
  - [ ] Resolve `ownerLabel`: `owner.displayName || owner.email || strings.anonymousOwnerFallback`.
  - [ ] Interpolate `{ownerLabel}` into `body` template.
  - [ ] Add `kind: "share_granted"` / `kind: "share_revoked"` to the emitted `detail` object.
  - [ ] Extend the `ShareNotificationInput.detail` type in-file to include `kind`.

### API — Postgres call sites (3 JOIN updates)

- [ ] `apps/api/src/persistence/postgres.ts:~780-830` (share-granted via direct grant) — extend the `INSERT ... RETURNING` and the existing-share `SELECT` to return `grantee.locale AS grantee_locale`; pass to `buildShareGrantedNotification`.
- [ ] `apps/api/src/persistence/postgres.ts:~860-925` (revoke) — extend the FOR UPDATE `SELECT ps.id ... FROM portfolio_shares ps JOIN users owner ... JOIN users grantee` with `grantee.locale AS grantee_locale`; pass to `buildShareRevokedNotification`.
- [ ] `apps/api/src/persistence/postgres.ts:~1340-1410` (share-coupled invite materialize) — extend the invite-query JOIN to surface grantee locale (grantee is the accepting user — already identified as `input.userId`); pass to `buildShareGrantedNotification`.
- [ ] Update the wrapper functions at `postgres.ts:266-288` (`buildShareGrantedNotification` / `buildShareRevokedNotification`) to accept and forward `granteeLocale`.

### API — Memory call sites (3 inline lookups)

- [ ] `apps/api/src/persistence/memory.ts:482` (share-granted known user) — inline `this.stores.get(grantee.id)?.settings.locale ?? "en"`; pass to `buildShareGrantedNotification`.
- [ ] `apps/api/src/persistence/memory.ts:515` (revoke) — inline `this.stores.get(share.granteeUserId)?.settings.locale ?? "en"`; pass to `buildShareRevokedNotification`.
- [ ] `apps/api/src/persistence/memory.ts:744` (invite materialize) — inline `this.stores.get(input.userId)?.settings.locale ?? "en"`; pass to `buildShareGrantedNotification`.

### Web — matcher refactor

- [ ] `apps/web/components/layout/AppShell.tsx:~351-377` (`handleSharingNotification`): change the revoke condition from `notification.title === "Portfolio access revoked"` (line 417) to `notification.detail?.kind === "share_revoked"`. Preserve the surrounding `ownerUserId === currentContextOwnerId` guard and the teardown sequence (`clearContextCookie()` + toast + refresh).
- [ ] Narrow `notification.detail` via a local type guard before reading `kind` and `ownerUserId` (avoid casting to `any`).

### Tests — unit (API)

- [ ] Create `apps/api/test/unit/shareHelpers.test.ts` (or extend if one exists):
  - [ ] `buildShareGrantedNotification` with `granteeLocale: "en"` → English title/body, `detail.kind === "share_granted"`.
  - [ ] `buildShareGrantedNotification` with `granteeLocale: "zh-TW"` → zh-TW title/body, `detail.kind === "share_granted"`.
  - [ ] `buildShareRevokedNotification` with `granteeLocale: "en"` → English title/body, `detail.kind === "share_revoked"`.
  - [ ] `buildShareRevokedNotification` with `granteeLocale: "zh-TW"` → zh-TW title/body, `detail.kind === "share_revoked"`.
  - [ ] Anonymous owner fallback (`displayName = null, email = null`): `en → "Someone"`, `zh-TW → "某人"`.

### Tests — integration (Postgres)

- [ ] Create `apps/api/test/integration/sharing-notification-locale.integration.test.ts` per `integration-test-persistence-direct.md` pattern (use `PostgresPersistence` directly, not `buildApp`):
  - [ ] Seed owner + grantee users; update `users.locale = 'zh-TW'` for grantee.
  - [ ] Call `createShareGrant(...)`; assert the resulting notification row has zh-TW `title`, zh-TW `body` with owner label interpolated, and `detail.kind === "share_granted"`.
  - [ ] Call `revokeShareGrant(...)`; assert zh-TW notification with `detail.kind === "share_revoked"`.
  - [ ] Also verify one `locale = 'en'` control case, and the invite-materialize flow.

### Tests — unit (web)

- [ ] Extend the existing `useNotifications` / `AppShell` matcher unit test (or create if absent) to assert the revoke handler triggers on `detail.kind === "share_revoked"` regardless of title text. Include a zh-TW title with `detail.kind === "share_revoked"` → handler fires; an unrelated notification with same title but different `detail.kind` → handler does not fire.

### Verification

- [ ] Run `npm run test --prefix apps/api` (suite 4).
- [ ] Run `npm run test:integration:full:host` (suite 5) — verifies new Postgres integration test + no regression in others.
- [ ] Run `npm run test --prefix apps/web` (suite 3).
- [ ] Run `npm run test:e2e:bypass:mem --prefix apps/web` (suite 6) — verifies `sharing-revoke-confirm-and-notification-aaa.spec.ts` still passes (en path, matcher refactor).
- [ ] Run `npm run test:e2e:oauth:mem --prefix apps/web` (suite 7).
- [ ] Run `npm run test:http --prefix apps/api` (suite 8).
- [ ] Run `npx eslint .` + `npm run typecheck`.
- [ ] Pre-push: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` per `full-test-suite.md`.

### Documentation

- [ ] Update `docs/001-architecture/sharing.md` (lines ~187-188) — replace the English-only notification title bullets with a note that titles/bodies are localized per grantee's `users.locale` at emit time; reference the `detail.kind` discriminator for frontend matchers.

---

## Out of Scope (do not expand)

- KZO-132 `daily_refresh` notification localization (`apps/api/src/services/notificationService.ts:92-103`) — same class of issue; tracked separately for a repo-wide pass.
- Retroactive localization of pre-existing notification rows written without `detail.kind` — accepted as known limitation (matcher fires on SSE push, not bell re-read).
- Web UI locale-selection plumbing audit (browser/localStorage fallback behavior) — noted during grill, not this ticket's lane.
- `ShareUser` type changes — stays narrow; owner identity doesn't need locale.
- Shared i18n package (`libs/i18n` or similar) — premature with only this one current consumer.

## Open Items — none

All items surfaced during the grill were resolved in-scope.

## References

- Linear: KZO-151 (this ticket), KZO-145 (predecessor, merged), KZO-146 (predecessor, merged), KZO-132 (related — out of scope)
- Related rules: `nextjs-i18n-serialization.md`, `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `full-test-suite.md`, `service-error-pattern.md`, `interface-caller-verification.md`
