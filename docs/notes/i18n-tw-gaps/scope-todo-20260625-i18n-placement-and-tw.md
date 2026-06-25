---
slug: i18n-tw-gaps
source: scope-grill
created: 2026-06-25
tickets: []
required_reading: []
superseded_by: null
---

# Todo: i18n Placement Refactor And zh-TW Translation Gaps

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Use the existing owned-dictionary pattern; do not introduce a mega dictionary or migrate to a new i18n framework.
2. Add typed locale-aware resolvers for shared surfaces: shell labels, breadcrumbs, connector scopes, and ChatGPT widgets.
3. Include ChatGPT connector and embedded widget copy in this scope.
4. Translate all frontend-owned UI copy to first-pass Taiwan Traditional Chinese.
5. Preserve technical nouns and codes such as `ChatGPT`, `MCP`, `OAuth`, `API`, `AI`, `TWD`, market codes, provider names, ticker symbols, and operation IDs.
6. Cover stable frontend-authored admin market-data UI copy, excluding provider/evidence/API-supplied operational data.
7. Cover visible loading, error, and not-found copy. Metadata is best-effort, not a hard gate.
8. Limit scope to frontend-owned copy plus known enum/status mappers. Arbitrary backend, user, and provider strings are out of scope.
9. Ship as one PR with four intentional commits:
   1. i18n plumbing/refactor.
   2. Shared shell, breadcrumbs, and visible loading/error copy.
   3. ChatGPT connector/widgets and transactions AI Inbox.
   4. Admin/admin-market-data translations and guardrails.
10. Add guardrails: dictionary parity tests, focused shell/breadcrumb render tests, and a scoped hardcoded-English scan with allowlist.
11. ChatGPT widgets must accept and normalize an explicit locale prop; do not rely only on `document.documentElement.lang`.
12. Use Taiwan Traditional Chinese terminology such as `投資組合`, `交易`, `持股`, `報表`, `帳戶`, `股利`, `現金流水`, and `代號`; avoid Mainland terms such as `信息`, `配置`, and `项目`.

## Implementation Steps

- [x] Add or adjust dictionary modules for layout shell, breadcrumb labels, connectors, ChatGPT widgets, AI Inbox, and admin market-data copy.
- [x] Replace `apps/web/lib/breadcrumb-titles.ts` English-only behavior with locale-aware label resolution.
- [x] Thread localized labels into `ThemeToggle`, `ProfileMenu`, `CommandPaletteTrigger`, `SidebarResizeRail`, breadcrumbs, and related shell components.
- [x] Add explicit locale prop/normalization to both ChatGPT widgets and pass locale from connector/harness pages where possible.
- [x] Move connector scope labels into a localized dictionary/resolver.
- [x] Translate frontend-owned ChatGPT widget and transactions AI Inbox copy.
- [x] Translate stable frontend-owned admin overview, admin settings, and admin market-data copy.
- [x] Translate visible ticker loading/error fallback copy and other identified loading/error/not-found states.
- [x] Add parity tests for touched dictionary families.
- [x] Add focused tests for zh-TW breadcrumbs and localized shell labels.
- [x] Add a scoped hardcoded-English scan test for agreed high-risk files/directories.
- [x] Run focused web tests, at minimum `npm run test --prefix apps/web`; broaden only if implementation touches wider contracts.

## Open Items

- [ ] None.

## References

- Scope debate note: none.
- Linear tickets: none.
