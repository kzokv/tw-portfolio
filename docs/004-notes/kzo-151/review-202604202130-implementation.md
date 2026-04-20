---
type: code-review
ticket: KZO-151
iteration: 1
reviewer: code-reviewer (Sonnet, Tier 2)
created: 2026-04-20
---

# Code Review — KZO-151 Iteration 1

Sharing notification zh-TW localization + frontend matcher refactor.

Reviewed files: `shareNotificationStrings.ts` (new), `shareHelpers.ts`, `postgres.ts`,
`memory.ts`, `AppShell.tsx`, `sharing-notification-matcher.ts` (new),
`shareHelpers.test.ts` (new), `sharing-notification-locale.integration.test.ts` (new),
`sharing-notification-matcher.test.ts` (new).

---

## Critical

_None._

---

## High

_None._

---

## Medium

**MED-1** [`docs/001-architecture/sharing.md:187-188`] — English-only notification title bullets still present; doc not updated.

Lines 187-188 still read:
```
- share granted: "Portfolio shared with you"
- share revoked: "Portfolio access revoked"
```
The scope-todo (line 174) explicitly requires replacing these with a note that titles/bodies are localized per grantee's `users.locale` at emit time, and that frontend matchers must use `detail.kind` rather than the title string. This is the only documented update missing from the implementation.

**Recommendation:** Update `docs/001-architecture/sharing.md:186-190` to document locale-aware rendering and the `detail.kind` discriminator before PR creation.

---

## Low

**LOW-1** [`apps/web/lib/sharing-notification-matcher.ts:22-27`] — `isRevokedSharingNotification` is exported but has no production caller.

`AppShell.tsx` uses `extractSharingNotificationDetail(notification.detail)` + inline
`detail?.kind === "share_revoked"` check. `isRevokedSharingNotification` is only called
from the test file (`sharing-notification-matcher.test.ts`). Per `interface-caller-verification.md`,
exported functions should have at least one production caller, or be removed if test-only.

**Recommendation (two options):**
1. Use `isRevokedSharingNotification` in `AppShell.tsx` instead of the inline `detail?.kind` check — simplifies the handler and gives the export a production caller.
2. If the inline check is preferred, remove the export (keep only `extractSharingNotificationDetail` exported) and inline or unexport `isRevokedSharingNotification`.

Option 1 is cleaner and removes the dead-export concern entirely.

---

**LOW-2** [`apps/api/test/integration/sharing-notification-locale.integration.test.ts:107-108, 137, 169-170, 174, 214, 219`] — Repeated `as { kind: string }` casts for `detail` access.

`(notif.detail as { kind: string }).kind` appears 6 times. Since `NotificationDto.detail` is
`unknown`, a local inline helper type guard or a `assertSharingDetail` helper would make assertions
cleaner and catch typos at compile time. Not blocking but reduces readability of the assertion chain.

**Recommendation (optional):** Extract a local `toSharingDetail(d: unknown)` test helper that does the same safe cast once and narrows the type. Not a blocker; existing cast is type-safe in context.

---

## Informational

**INFO-1** — `grantee_locale AS grantee_locale` appears in only one SQL statement (revoke path, `postgres.ts:882`). Sites 1 and 3 fetch `locale` via a separate `SELECT id, email, display_name, locale FROM users WHERE id = ANY(...)` / `WHERE id = $1` before the main operation. This is architecturally correct and avoids complex join rewrites. Diverges from "JOIN updates" language in the scope-todo, but is functionally equivalent and simpler. No action needed.

**INFO-2** — `sharing-notification-locale.integration.test.ts` uses `await import()` (dynamic) while sibling `anonymous-share-tokens.integration.test.ts` uses a static import for `PostgresPersistence`. The new file follows the `integration-test-persistence-direct.md` rule's documented dynamic-import pattern. The sibling predates the rule. No action needed; new pattern is the preferred one per the rule.

**INFO-3** — `SharingNotificationDetail` on the web side omits `shareId`. The API's `ShareNotificationDetail` includes it. Intentional per scope decision (web doesn't need `shareId` for the revoke-teardown flow). No action needed.

---

## Grep checklist results

1. `grep -n "function\|=>" shareNotificationStrings.ts` → **PASS** — zero function values; all string literals.
2. `grep -n "grantee_locale" postgres.ts` → **PARTIAL** — appears at line 872 (type annotation) and 882 (SQL alias) for the revoke path only. Sites 1 and 3 use a separate user-lookup that includes `locale` in the SELECT. Functionally correct; see INFO-1.
3. `grep -n "buildShareGrantedNotification\|buildShareRevokedNotification" postgres.ts` (callers pass granteeLocale) → **PASS** — lines 809, 926, 1412 all pass `granteeLocale` (via `grantee.locale` or `share.grantee_locale`).
4. `grep -n "buildShareGrantedNotification\|buildShareRevokedNotification" memory.ts` → **PASS** — lines 484, 520, 752 all pass `granteeLocale` via inline `this.stores.get(...)?.settings.locale ?? "en"`.
5. `grep -rn "buildShareGrantedNotification\|buildShareRevokedNotification" apps/ libs/` (stale callers) → **PASS** — callers: memory.ts (3), postgres.ts (3 + 2 wrappers), test unit file. All pass the required 4-argument signature.
6. `grep -n "Portfolio access revoked\|notification.title ===" AppShell.tsx` → **PASS** — zero occurrences; old title-match fully removed.
7. `grep -n "detail?.kind|detail.kind" AppShell.tsx` → **PASS** (confirmed by source inspection) — line 415 uses `detail?.kind === "share_revoked"` via the extracted `detail` variable returned by `extractSharingNotificationDetail`.
8. `grep -n "as any\|: any" AppShell.tsx` → **PASS** — zero occurrences. The helper in `sharing-notification-matcher.ts` uses `as Record<string, unknown>` (safe) not `as any`.
9. `grep -n "PostgresPersistence\|buildApp" sharing-notification-locale.integration.test.ts` → **PASS** — `PostgresPersistence` via dynamic import on line 25; `buildApp` is absent.
10. `grep -n '"某人"\|"Someone"' shareHelpers.test.ts` → **PASS** — no hardcoded glyphs in assertions; all assertion bodies read from `shareNotificationStrings[locale].anonymousOwnerFallback` via `expectedBody(strings.shareGranted.body, strings.anonymousOwnerFallback)`.

---

## Summary

Implementation is clean and architecturally sound. Two actionable items before PR:

1. **MED-1** (blocking) — Update `docs/001-architecture/sharing.md:186-190`.
2. **LOW-1** (recommended) — Either use `isRevokedSharingNotification` in `AppShell.tsx` or unexport it.

LOW-2 is optional cleanup. INFO items require no action.
