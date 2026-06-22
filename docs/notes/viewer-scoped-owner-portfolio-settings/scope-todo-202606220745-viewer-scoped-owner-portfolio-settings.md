---
slug: viewer-scoped-owner-portfolio-settings
source: scope-grill
created: 2026-06-22
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Viewer-Scoped Owner Portfolio Settings

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- `priceColorConvention` is viewer-scoped everywhere, including while viewing another owner's shared portfolio.
- Shared portfolio pages show a sticky, quiet context strip: opaque, muted, static after a short one-time context-change transition.
- `/settings/accounts` is owner-scoped only when the viewer has `account:manage`; in shared context it is labeled as portfolio settings.
- `/sharing` is owner-scoped only when the viewer has new `sharing:manage`.
- `sharing:manage` covers named-user shares and pending invites only; public anonymous link management stays owner-only.
- Delegated sharing managers cannot grant capabilities beyond their own active grant set and cannot grant `sharing:manage` onward.
- Missing grants hide nav entries and show permission-required states on direct URL access.
- Reporting currency, other preference scoping, anonymous-link delegation, and cleaner future routes are out of scope.

## Implementation Steps

- [x] Add `sharing:manage` to shared capability types, schemas, labels, and assignable capability UI.
- [x] Extend backend shared-context route guards for owner-scoped named share list/create/edit/revoke.
- [x] Enforce constrained delegation for delegated share managers.
- [x] Keep anonymous share-token routes owner-only in shared context and hide/disable public-link management in delegated sharing view.
- [x] Add explicit API client support for session-vs-portfolio context where identity pages need to suppress `x-context-user-id`.
- [x] Make `priceColorConvention` hydrate and apply from the viewer's preferences, not the portfolio owner's settings.
- [x] Add the sticky shared-context strip to the app shell for shared portfolio pages.
- [x] Gate `/settings/accounts` with `account:manage`; label it as portfolio settings in shared context and show a permission-required state without the grant.
- [x] Gate `/sharing` with `sharing:manage`; show owner-scoped named-share management only and show a permission-required state without the grant.
- [x] Update sidebar/profile navigation labels and visibility for shared context.
- [x] Add focused unit/API tests for capability enforcement and session-vs-portfolio context fetch behavior.
- [x] Add/update E2E tests covering shared context strips, gated nav, permission states, and delegated sharing/account access.

## Validation

- `npx eslint .` passed.
- `npm run typecheck` passed.
- `npm run test --prefix apps/web` passed: first Vitest phase `54 passed / 331 tests`; second phase `61 passed / 418 tests`.
- `npm run test --prefix apps/api` passed: `173 passed`, `44 skipped`; `1718 passed`, `431 skipped`.
- `npm run test:integration:full:host` passed with exit code 0.
- `npm run test:e2e:bypass:mem --prefix apps/web` passed: `296 passed`, `16 skipped`.
- `npm run test:e2e:oauth:mem --prefix apps/web` passed: `120 passed`.
- `npm run test:http --prefix apps/api` passed: `296 passed`, `2 skipped`.
- `npx playwright test --config=tests/e2e/playwright.oauth.config.ts portfolio-card-reorder-aaa.spec.ts` passed after stabilizing the portfolio card drag assertion: `2 passed`.
- `git diff --check` passed.
- Mockup artifacts generated:
  - `docs/notes/viewer-scoped-owner-portfolio-settings/mockups/viewer-scoped-owner-portfolio-settings-desktop.png`
  - `docs/notes/viewer-scoped-owner-portfolio-settings/mockups/viewer-scoped-owner-portfolio-settings-mobile.png`
  - `docs/notes/viewer-scoped-owner-portfolio-settings/mockups/viewer-scoped-owner-portfolio-settings.html`
  - `docs/notes/viewer-scoped-owner-portfolio-settings/mockups/capture-viewer-scoped-owner-portfolio-settings.mjs`

## Open Items

- [ ] Follow up on whether reporting currency, holding allocation basis, dashboard ranges, card order, and table settings should be viewer-scoped or owner-scoped.
- [ ] Follow up on whether public anonymous share links need a separate delegated capability.
- [ ] Consider a cleaner long-term route such as `/portfolio/settings/accounts` for owner-scoped portfolio administration.

## References

- Mockups: `docs/notes/viewer-scoped-owner-portfolio-settings/mockups/`
- Worktree branch: `codex/viewer-scoped-owner-portfolio-settings`
