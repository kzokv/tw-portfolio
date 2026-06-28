---
slug: ai-tool-connectors-connector-history-permissions
source: scope-grill
created: 2026-06-28
tickets: []
required_reading:
  - docs/notes/ai-tool-connectors/scope-todo-202606271344-all-in-one-mcp.md
superseded_by: null
---

# Todo: AI Connector History and Permission Identity

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Add a separate `History` tab for revoked and expired AI connector history.
2. History uses a compact responsive table/list, not full connection cards.
3. History filters are:
   - Search by display name, client label, or connector ID.
   - Status: all, revoked, expired.
   - Client kind: all supported AI client kinds.
   - Auth mode: all, OAuth, bearer.
   - Ended date: all, last 7 days, last 30 days, last 90 days.
4. History filters are client-side for this pass after loading visible history from `/ai/connectors/history`.
5. User-facing `Remove from history` is a soft removal via `hidden_at`; no hard delete.
6. Removed history disappears from normal user history. Do not add a persistent removed-history filter for normal users.
7. Support single remove and bulk remove.
8. Bulk remove selects the currently visible filtered rows only.
9. Bulk remove requires confirmation and clarifies audit records are retained.
10. Use a shared connection details sheet for active and historical rows.
11. Detail sheet includes client identity, status/reason, timestamps, auth/vendor/client kind, scopes, tool overrides, recent calls, connector ID, and status-aware actions.
12. Detail sheet shows up to 5 recent calls for the selected connector and links to Activity filtered by connector.
13. Active connection cards add a `Permissions` deep-link to `section=permissions&client=<id>`.
14. Permission blocks get strong client identity headers so ChatGPT vs Claude.ai is obvious.
15. Keep backend/internal `hide` naming if useful, but user-facing copy and tests should say `Remove from history`.

## Implementation Steps

- [x] Add `history` to AI connector section routing, side navigation, query-state handling, and tab count.
- [x] Count the History tab as visible non-hidden revoked/expired rows before filters.
- [x] Move historical connection rendering out of the Connections section and into the new History tab.
- [x] Build a compact desktop table and mobile stacked list for History rows.
- [x] Add client-side History filters for search, status, client kind, auth mode, and ended date.
- [x] Add row selection, select-visible checkbox, selected count, and `Remove selected` bulk action.
- [x] Add confirmation copy for single and bulk remove that says records are removed from user-visible history while audit records are retained.
- [x] Reuse the existing `/ai/connectors/:id/hide` soft-remove endpoint for single remove.
- [x] Add a bulk soft-remove API endpoint only if the implementation would otherwise issue excessive per-row requests or create poor error handling.
- [x] Add a shared connection detail sheet component for active and historical connections.
- [x] Populate the detail sheet with identity, status/reason, timestamps, auth/vendor/client kind, scopes, tool overrides, recent calls, connector ID, and status-aware actions.
- [x] Extend the frontend connector logs fetcher to accept `connectionId`.
- [x] Make Activity accept and honor a `connectionId` query/filter for deep-linked connector calls.
- [x] Add `View all in Activity` from the detail sheet with `section=activity&connectionId=<id>`.
- [x] Add `Permissions` action on active connection rows/cards that deep-links to `section=permissions&client=<id>`.
- [x] Add strong identity headers to each permission block/card with icon, client label, display name, status chip, auth mode chip, last used, expires, `Details`, and `Back to connection`.
- [x] Ensure the permission identity header wraps cleanly at narrow widths.
- [x] Update English and zh-TW copy for the History tab, filters, details sheet, remove confirmations, bulk remove, permissions deep-link, and permission identity headers.
- [x] Update component/unit tests for History tab navigation, filtering, single remove, bulk remove, detail sheet, recent calls, Activity deep-linking, active Permissions deep-link, and permission identity headers.
- [x] Run `/aaa` to add or update E2E tests covering the new user-facing History and permissions flows.
- [x] Validate desktop and mobile responsiveness for History filters/table/list, detail sheet, and permission headers.

## Out Of Scope

- [ ] Hard deletion of connector history rows.
- [ ] Persistent normal-user view of removed history.
- [ ] Server-side history pagination/filtering.
- [ ] Scope, risk, or tool filters in the History tab.
- [ ] Bulk revoke from History.
- [ ] Full rewrite of active Connections into a table.

## Open Items

- [x] Decide whether to generate mockup screenshots before implementation.

## Implementation Evidence

- 2026-06-28 implementation files:
  - `apps/web/components/settings/AiConnectorsSettingsClient.tsx`
  - `apps/web/features/ai-inbox/service.ts`
  - `apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx`
  - `apps/web/test/features/settings/services/aiInboxService.test.ts`
  - `apps/web/tests/e2e/specs/ai-connectors-sharing-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/ai-connectors-history-responsive-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/mobile-ai-connectors-history-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/helpers/aiConnectorsMock.ts`
  - `apps/api/test/integration/mcp.integration.test.ts`
- 2026-06-28 bulk endpoint decision:
  - No bulk API endpoint was added. The UI uses the existing row-local `POST /ai/connectors/:id/hide` endpoint with `Promise.allSettled` for selected visible rows. This keeps failure handling row-specific and avoids widening the API surface for the current bounded history view.
- 2026-06-28 generated mockups:
  - `docs/notes/ai-tool-connectors/mockups/connector-history-desktop.png`
  - `docs/notes/ai-tool-connectors/mockups/connector-history-mobile.png`
  - `docs/notes/ai-tool-connectors/mockups/connector-permissions-desktop.png`
  - `docs/notes/ai-tool-connectors/mockups/connector-permissions-mobile.png`
- 2026-06-28 validation commands:
  - `npx tsc -p apps/web/tsconfig.json --noEmit`
  - `npx vitest run test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web` passed with 21 tests.
  - `npx vitest run test/features/settings/services/aiInboxService.test.ts` from `apps/web` passed with 2 tests.
  - `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web` passed.
  - `npx playwright test tests/e2e/specs/ai-connectors-sharing-aaa.spec.ts --config=tests/e2e/playwright.config.ts` from `apps/web` passed with 5 tests after rebuilding standalone output. The History and Permissions cases use deterministic connector API route mocks so they always exercise a historical row, detail sheet, Activity deep link, single remove, bulk remove, and active permission identity headers.
  - `npx playwright test tests/e2e/specs/ai-connectors-history-responsive-aaa.spec.ts tests/e2e/specs/mobile-ai-connectors-history-aaa.spec.ts --config=tests/e2e/playwright.config.ts` from `apps/web` passed with 3 tests across desktop, mobile, and tablet projects. These tests use deterministic connector API route mocks, open the shared connection detail sheet, and assert no page-level horizontal overflow for History, detail sheet, and Permissions.
  - `npx vitest run test/integration/mcp.integration.test.ts -t "exposes and revokes ChatGPT connector connections through the user API|rejects hide for active connectors and keeps the row unchanged|filters and paginates connector access logs for the Activity feed|filters connector access logs by connectionId"` from `apps/api` passed with 4 tests.
  - `npx eslint apps/web/components/settings/AiConnectorsSettingsClient.tsx apps/web/features/ai-inbox/service.ts apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx apps/web/test/features/settings/services/aiInboxService.test.ts apps/web/tests/e2e/specs/ai-connectors-sharing-aaa.spec.ts apps/api/test/integration/mcp.integration.test.ts` exited 0; Playwright reported two conditional-test warnings in the adaptive E2E smoke.
  - `git diff --check` passed.
- 2026-06-28 full local gate evidence after latest `origin/dev` fetch:
  - `git merge-base --is-ancestor origin/dev HEAD` exited 0; `origin/dev` was still contained in this branch head.
  - `npx eslint .` exited 0 with six `playwright/no-conditional-in-test` warnings in the responsive connector E2E guard specs and no errors.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web -- --reporter=dot` passed with 125 test files and 830 tests across its two Vitest shards.
  - `npm run test --prefix apps/api -- --reporter=dot` passed with 183 files passed, 44 skipped, 1839 tests passed, and 437 skipped.
  - `npm run test:integration:full:host` passed against the managed Postgres/Redis stack with 93 files passed, 943 tests passed, and 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed with 304 tests passed and 17 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed with 121 tests passed.
  - `npm run test:http --prefix apps/api` passed with 298 tests passed and 2 skipped.
  - `git diff --check` passed.
  - `/si-review` quick audit found no new durable promotion candidate beyond existing `.claude/rules` coverage; `/si-promote` was skipped.
- 2026-06-28 responsive screenshot artifacts:
  - `apps/web/test-results/ai-connectors-history-desktop-validation.png`
  - `apps/web/test-results/ai-connectors-permissions-desktop-validation.png`
  - `apps/web/test-results/ai-connectors-detail-desktop-validation.png`
  - `apps/web/test-results/ai-connectors-history-chromium-mobile-validation.png`
  - `apps/web/test-results/ai-connectors-permissions-chromium-mobile-validation.png`
  - `apps/web/test-results/ai-connectors-detail-chromium-mobile-validation.png`
  - `apps/web/test-results/ai-connectors-history-chromium-tablet-validation.png`
  - `apps/web/test-results/ai-connectors-permissions-chromium-tablet-validation.png`
  - `apps/web/test-results/ai-connectors-detail-chromium-tablet-validation.png`

## References

- Prior all-in-one MCP scope: `docs/notes/ai-tool-connectors/scope-todo-202606271344-all-in-one-mcp.md`
- Validated dev UI state on 2026-06-28: active `Claude.ai` and `ChatGPT` connections are visible; History remains embedded under Connections with 88 historical rows; Permissions has two active rows without sufficiently clear client identity.
