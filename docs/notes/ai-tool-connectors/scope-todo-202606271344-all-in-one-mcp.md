---
slug: ai-tool-connectors
source: scope-grill
created: 2026-06-27
tickets: []
required_reading: []
superseded_by: null
---

# Todo: All-In-One MCP Server And AI Connectors Redesign

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Keep one shared `/mcp` all-in-one MCP server rather than separate MCP servers per AI tool.
2. Treat ChatGPT / OpenAI Apps, Claude Code, and Codex CLI/IDE as Tier 1 live-certified clients.
3. Treat Gemini CLI, VS Code / Copilot MCP, and Generic MCP clients as Tier 2 documented clients.
4. Keep Google Gemini app / Gemini Enterprise connector out of scope for this V1 because it does not match the desired self-hosted Gemini app connector behavior.
5. Replace the flat connector `provider` model with `vendor + clientKind + capabilities`.
6. Preserve existing ChatGPT connections without forcing users to reconnect.
7. Use OAuth-first production auth for Tier 1 where cleanly supported; scoped, revocable bearer fallback is acceptable for developer MCP clients.
8. Add a portable interactive-operation architecture, but migrate only transaction draft review/posting in V1.
9. Use authenticated Vakwen web deep links as fallback for non-widget clients. Do not add magic-token review links in V1.
10. Replace ChatGPT-specific admin policy with client-kind allowlist plus shared tool-group toggles.
11. Redesign Settings -> AI Connectors as a setup-first command center.
12. Redesign only the MCP connector policy area in Admin Settings. Do not redesign the whole Admin Settings surface.
13. Share user/admin UI primitives only. Keep page containers, data loading, and mutation flows separate.
14. Make Activity a filtered recent feed with load more, not a full audit/export console.
15. Treat responsive behavior as a hard requirement, including safe wrapping for long text/config and mobile-specific permission controls.
16. Add a separate MCP Tool Catalog section independent of connected AI clients so users can view, inspect, and audit MCP tools without confusing tools with connectors.
17. Model tool availability as layered effective access: global MCP policy, client-kind allowlist, connector active state, granted scope/risk group, connector-specific tool override, and share/delegated capability at call time.
18. Treat per-tool toggles as narrowing controls only. Tool toggles must never grant capability beyond the connector's granted scopes or global policy.
19. Align implementation closely with the approved dense command-center mockup direction, including standalone Tool Catalog, section navigation, compact rows, restrained status chips, and responsive mobile accordions.
20. Support deep links into the settings page for section and selected tool/client state where practical, such as `?section=tool-catalog&tool=post_transaction_draft_rows`.
21. Support bearer fallback as user-generated connector instances when admin policy allows it. Bearer tokens must be scoped, expiring, one-time displayed, revocable, audited, and clearly secondary to OAuth.
22. Admin MCP settings must include a compact Bearer fallback policy panel with enabled state, allowed client kinds, max bearer lifetime, max active bearer connectors per user, and allowed bearer tool groups.
23. Prefer separate OAuth and bearer credential blast radius. OAuth token secret rotation should clearly state which OAuth connector credentials are revoked and should not silently revoke bearer fallback connectors unless the implementation intentionally shares credential secrets.

## Implementation Steps

- [x] Add a forward migration for connector identity: preserve existing `provider`, add or derive `vendor`, `client_kind`, and `capabilities`, and map existing `chatgpt` rows to `openai/chatgpt_app` and `self_hosted` rows to `generic/generic_mcp`.
- [x] Update shared types, persistence records, DTO mappers, memory persistence, Postgres persistence, and policy settings to use the new connector identity model while maintaining transitional compatibility where needed.
- [x] Introduce a central MCP client registry for ChatGPT / OpenAI Apps, Claude Code, Codex CLI/IDE, Gemini CLI, VS Code / Copilot MCP, and Generic MCP, including display labels, tier, vendor, client kind, auth modes, capability flags, docs links, and setup snippet templates.
- [x] Refactor ChatGPT-specific MCP compatibility code into generic MCP compatibility plus OpenAI Apps-specific metadata/resource adapters.
- [x] Preserve current ChatGPT OAuth behavior, including existing redirect allowlist behavior, token refresh, access logs, scopes, and ChatGPT Apps widget metadata.
- [x] Add connection paths for Claude Code and Codex CLI/IDE using the shared client registry and OAuth-first or scoped bearer fallback behavior agreed in scope.
- [x] Ensure bearer fallback connector instances are scoped, expiring, revocable, visible in AI Connectors, audited, one-time displayed, and not presented as the primary consumer production auth path.
- [x] Add admin-governed bearer fallback policy covering enabled/disabled state, allowed client kinds, maximum bearer token lifetime, maximum active bearer connectors per user, and allowed bearer tool groups.
- [x] Add user-facing bearer connector creation from supported Connect cards as a secondary flow: choose client kind, display name, expiry capped by policy, scopes/tool groups capped by policy, then show the bearer token once.
- [x] Store bearer fallback credentials so plaintext tokens cannot be recovered after creation; rotate/recreate flows must issue a new credential or connector and revoke the old one.
- [x] Separate or explicitly document OAuth credential secret blast radius from bearer credential blast radius; admin UI must say exactly which connector families are affected by OAuth token secret rotation or clear.
- [x] Update MCP OAuth/token activation logic so the activated connection uses the resolved `vendor/clientKind` rather than hardcoded ChatGPT provider values.
- [x] Update admin policy from ChatGPT-specific toggles to client-kind allowlist plus shared tool group toggles for read, drafts, account management/write, and posting.
- [x] Add a shared MCP readiness model used by both the user AI Connectors page and Admin MCP settings area, covering deployment enabled, public issuer, OAuth token secret, URL readiness, client-kind policy, and high-risk tool state.
- [x] Define one canonical blocker priority for effective availability display: global MCP disabled, client kind disabled, connector inactive, missing scope/risk group, admin tool policy disabled, connector override disabled, delegated share capability blocked.
- [x] Build shared UI primitives for status chips, readiness summary, client setup cards, copyable URL/snippet blocks, risk/tool-group labels, empty states, and repair states.
- [x] Redesign Settings -> AI Connectors as a single-page section-nav layout with Overview, Connect, Connections, Permissions, Tool Catalog, and Activity sections.
- [x] Support URL state/deep links for the active section and selected tool/client where it helps support, docs, or direct inspection without adding separate routes.
- [x] Implement the command-center first viewport with MCP URL copy action, readiness chips, active client counts, and high-risk state.
- [x] Implement Connect setup cards with expandable copyable snippets for Tier 1 and Tier 2 clients; keep inline guidance short and link to detailed docs.
- [x] Implement compact Connections rows/cards grouped by vendor/client kind, including active/pending/revoked/expired state, last used, expiry, reconnect where relevant, and revoke actions.
- [x] Implement Permissions as a desktop client-by-risk-group matrix with expandable per-tool overrides.
- [x] Implement mobile Permissions as per-client accordions rather than a squeezed matrix or page-level horizontal scroll.
- [x] Implement Tool Catalog as a standalone section for inspecting all MCP tools independent of connected clients.
- [x] In Tool Catalog, show each tool's name, description, risk group, required scope, default/admin policy state, effective availability summary, and recent activity summary when available.
- [x] Add Tool Catalog filters for risk group, availability, required scope, override state, and search by tool name/description.
- [x] Add a tool detail drawer or equivalent detail surface showing schema summary, required scope, risk annotations, connected clients that can use the tool, connected clients blocked from using it, the highest-priority blocker, and recent access outcomes.
- [x] Keep tool schema display summarized by default; expose raw or full schema only behind an explicit expand action if needed.
- [x] Use a side detail panel/drawer for desktop Tool Catalog inspection and a bottom sheet or accordion-style detail surface on mobile.
- [x] Make effective availability explanations explicit: global MCP disabled, client kind disabled, connector inactive, missing scope/risk permission, disabled by connector override, blocked by admin policy, or blocked by delegated share capability.
- [x] Ensure the Tool Catalog does not render the full tool list under every connected AI client by default; per-client tool overrides are accessed from Permissions and/or tool detail, not repeated connector cards.
- [x] Implement Activity as a filtered recent feed with load more; include client, client kind, tool name, result, access/risk kind, portfolio context when available, and denial reason for denied/error rows.
- [x] Keep Activity and Tool Catalog recent-activity summaries consistent by deriving them from the same access-log data and labels.
- [x] Extend `/ai/connectors/logs` or add a compatible endpoint to support Activity filters and pagination without turning the page into a full audit explorer.
- [x] Extend or add a connector/tool catalog endpoint as needed so the UI can show effective availability by client and highest-priority blockers without duplicating policy logic in the frontend.
- [x] Implement first-run and misconfigured states: emphasize MCP readiness and Connect cards when no clients exist; show role-aware repair CTAs when admin setup is required.
- [x] Redesign the MCP connector area in Admin Settings only, covering deployment toggle/status, public issuer/origin, OAuth token secret state/rotation, bearer fallback policy, client-kind allowlist, shared tool-group toggles, max lifetime, inactivity expiry, active cap, additional redirect URI allowlist, and readiness panel.
- [x] Obtain approval for the Admin MCP companion mockups/spec before implementation so the admin surface mirrors the approved user-page readiness/status primitives without redesigning unrelated admin settings.
- [x] Make role-aware repair CTAs exact: admins can open Admin MCP settings; non-admin users see an ask-admin state.
- [x] Keep Admin Settings unrelated sections unchanged except for links or anchors needed to reach the redesigned MCP connector area.
- [x] Implement bearer fallback as user-generated connector instances when admin policy allows it; do not make admins token brokers for normal user-owned connector setup in V1.
- [x] Introduce a widget host adapter boundary so ChatGPT uses the OpenAI bridge and non-widget clients receive structured responses plus authenticated Vakwen web fallback links.
- [x] Migrate transaction draft review/posting through the host adapter while preserving current posting confirmation gates, version checks, mutation audits, and ChatGPT inline widget behavior.
- [x] Add authenticated Vakwen deep-link fallback for transaction draft review/posting; require normal Vakwen web session and server-side authorization checks before any mutation.
- [x] Keep recompute portfolio, replay, price refresh, account management widgets, magic-token review links, admin-wide audit explorer, CSV/export logs, per-client global tool matrices, and consumer Google Gemini app setup out of V1.
- [x] Update operational docs and setup snippets for ChatGPT / OpenAI Apps, Claude Code, Codex CLI/IDE, Gemini CLI, VS Code / Copilot MCP, and Generic MCP.
- [x] Implement accessible keyboard and screen-reader behavior for section navigation, copy buttons, drawers, accordions, toggles, filters, and status/error announcements.
- [x] Add explicit loading, empty, and error states for each redesigned section without changing the dense command-center layout.
- [x] Run `/aaa` to add or update E2E tests covering the agreed user-facing settings, admin settings, auth/connector, setup, permission, tool catalog, activity, and fallback flows.

## Verification

- [x] Add migration/integration coverage proving existing ChatGPT rows map to `vendor=openai`, `clientKind=chatgpt_app`, and do not require reconnect.
- [x] Add API/unit coverage for client registry, client-kind policy, connector DTO mapping, bearer fallback connector instances, and access-log filtering.
- [x] Add MCP integration coverage for ChatGPT compatibility preservation and non-widget transaction draft/posting web fallback responses.
- [x] Add web unit coverage for the redesigned AI Connectors sections, responsive permission behavior, setup snippets, tool catalog effective availability states, misconfigured states, and admin MCP settings primitives.
- [x] Add E2E coverage for Settings -> AI Connectors command center, Connect cards, Permissions matrix/mobile accordion, Tool Catalog filters/detail drawer, deep links, Activity filters/load more, and Admin MCP readiness/policy controls.
- [x] Add accessibility-focused assertions where practical for keyboard navigation, focus management, accessible names, and live copy/status feedback.
- [x] Run the smallest relevant focused checks first, then broader regression checks.
- [x] Before declaring full repo pass, run all eight required suites listed in root `AGENTS.md`.
- [ ] Manually smoke Tier 1 clients: ChatGPT / OpenAI Apps, Claude Code, and Codex CLI/IDE. Record connection path, auth mode used, tools/list, at least one read tool, and the transaction draft/posting fallback or widget behavior.

### Manual Smoke Evidence

- 2026-06-27 local protocol-level MCP smoke, API only:
  - API command: `AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory PORT=4000 APP_CONFIG_ENCRYPTION_KEY=<64-hex-test-key> npm run dev --prefix apps/api`
  - Connection path: `http://localhost:4000/mcp`
  - Auth mode used: documented local dev-token bearer path for controlled diagnostics, with `clientId=codex_cli` and `clientId=claude_code` payloads.
  - `initialize`: returned `200 OK`, `mcp-session-id`, protocol version `2025-03-26`, server `vakwen-mcp`.
  - `tools/list`: returned 67 tools.
  - Read tool: `get_portfolio_overview` returned structured portfolio data for `portfolioContextUserId=user-1`.
  - Transaction draft fallback: `create_transaction_draft_batch` created batch `90f9b91c-8490-42b1-b748-9eeb946eb036`; `get_transaction_draft_batch_component` with a developer-client token returned `operation=transaction_draft_review`, no `openai/outputTemplate`, and `webFallback={ mode: "vakwen_web", requiresAuthenticatedSession: true, operation: "transaction_draft_review" }`.
  - Caveat: this proves the shared HTTP MCP endpoint and non-widget host-adapter behavior locally. It is not a live ChatGPT/OpenAI Apps, Claude Code, or Codex CLI/IDE client smoke, so the Tier 1 manual-smoke checkbox remains unchecked.
- 2026-06-27 isolated Claude Code CLI config smoke:
  - API command: same local memory API as above.
  - Connection path: `claude mcp add --transport http -s local vakwen http://localhost:4000/mcp --header "Authorization: Bearer <dev-token>"`
  - Auth mode used: documented local dev-token bearer path with `clientId=claude_code`.
  - Isolation: `HOME` and project directory were temporary paths, so the user's real Claude configuration was not modified.
  - `claude mcp get vakwen`: returned `Status: ✓ Connected`, `Type: http`, `URL: http://localhost:4000/mcp`.
  - Caveat: this verifies Claude Code's MCP client can connect to the local server, but it does not exercise a hosted/public bearer connector instance.
- 2026-06-27 isolated Codex CLI config smoke:
  - API command: same local memory API as above.
  - Connection path: `CODEX_HOME=<temp> codex mcp add vakwen --url http://localhost:4000/mcp --bearer-token-env-var VAKWEN_MCP_TOKEN`
  - Auth mode used: documented local dev-token bearer path with `clientId=codex_cli`.
  - Isolation: `CODEX_HOME` was a temporary path, so the user's real Codex configuration was not modified.
  - `codex mcp get vakwen --json`: returned enabled streamable HTTP config for `http://localhost:4000/mcp` with `bearer_token_env_var=VAKWEN_MCP_TOKEN`.
  - `codex mcp list`: showed `vakwen`, `Status=enabled`, `Auth=Bearer token`.
  - `codex doctor --json`: reported `mcp.config` status `ok`, configured servers `1`, streamable HTTP servers `1`; overall doctor failed only because the temp `CODEX_HOME` intentionally had no Codex auth credentials and the non-interactive terminal had `TERM=dumb`.
  - Caveat: current Codex CLI management commands validate configuration but do not expose a standalone MCP connection health check equivalent to `claude mcp get`; live tool invocation would require a normal Codex authenticated model run.

## Open Items

- [x] Confirm the exact Claude Code command/config snippet once implementation starts, using current official docs.
- [x] Confirm the exact Codex CLI/IDE config snippet once implementation starts, using current official docs.
- [x] Approve the Admin MCP companion mockups/spec before implementing the admin redesign.

## Explicitly Out Of Scope

- Google Gemini app / Gemini Enterprise connector support.
- Separate MCP servers per AI tool.
- Full Admin Settings redesign outside the MCP connector policy area.
- Full audit explorer, CSV export, or reporting for connector logs.
- Per-client-kind global tool-group matrix.
- Tool toggles that grant access beyond granted scopes/risk-group permissions or admin policy.
- Magic-token review links.
- Inline widgets for Claude Code, Codex, Gemini CLI, VS Code, or Generic MCP clients in V1.
- Full operation-widget redesign beyond transaction draft review/posting.
- Browser controls that attempt to validate external AI clients live from the app.

## References

- Current MCP route registration: `apps/api/src/mcp/registerMcpRoutes.ts`
- Current OAuth metadata: `apps/api/src/mcp/oauthMetadata.ts`
- Current OAuth authorize/token flow: `apps/api/src/mcp/oauthAuthorize.ts`, `apps/api/src/mcp/oauthToken.ts`
- Current OpenAI Apps compatibility surface: `apps/api/src/mcp/openAiAppsAdapter.ts`
- Current connector shared types: `libs/shared-types/src/index.ts`
- Current user AI Connectors UI: `apps/web/components/settings/AiConnectorsSettingsClient.tsx`
- Current Admin settings UI: `apps/web/components/admin/AdminSettingsClient.tsx`
- Current operations runbook MCP section: `docs/002-operations/runbook.md`
- User AI Connectors desktop/mobile mockups: generated in this scope session and should be persisted or regenerated before implementation if needed.
- Admin MCP desktop mockup: `docs/notes/ai-tool-connectors/mockups/admin-mcp-desktop.png`
- Admin MCP mobile mockup: `docs/notes/ai-tool-connectors/mockups/admin-mcp-mobile.png`

---

## Locked Scope Revision: Claude.ai And MCP UX Repair

Date: 2026-06-28 07:42 +0800

This revision captures follow-up scope from live Claude.ai connector testing and UI review. The original all-in-one MCP scope stays valid, but the shipped surface did not fully match the intended UX for non-ChatGPT clients, revoked connection handling, admin policy comprehension, or Tool Catalog inspection.

### Agreed Decisions

1. Genericize the OAuth consent surface away from ChatGPT-specific wording.
2. Keep the existing ChatGPT authorize route only as a compatibility implementation detail; visible copy should say AI connector authorization and show the detected client.
3. Add `Claude.ai` as a separate Tier 1 OAuth client kind, distinct from `Claude Code`.
4. Keep `Claude Code` as a separate Tier 1 developer MCP client.
5. Add client-aware redirect allowlist repair UX when `/oauth/authorize` rejects an unapproved callback.
6. Show Claude.ai's exact callback as a suggested admin quick-add: `https://claude.ai/api/mcp/auth_callback`.
7. Improve Admin MCP settings with concrete Tool groups, Redirect callbacks, and Audit impact sections.
8. Replace vague "high-risk tools" wording with named tool groups, affected tool counts, risk labels, and examples.
9. Reveal current redirect allowlist as labeled rows/chips, separating built-in callbacks, custom callbacks, and suggested callbacks.
10. Default user Connections to operational rows only: active, pending, and expired only when actionable.
11. Move revoked and non-actionable expired connections into a separate History/Revoked view with filters.
12. Exclude revoked and expired connections from Permissions.
13. Preserve audit logs; cleanup only hides/removes revoked rows from the user-facing operational view unless a later scope explicitly defines hard deletion.
14. Fix active Claude-family connections missing from Connections.
15. Redesign Tool Catalog as compact rows plus a drawer/popover detail surface.
16. Rename the Tool Catalog detail `Blocked` section to `Unavailable for` and explain the highest-priority blocker reason.
17. Show latest 5 calls in tool detail and link to Activity for full filtered history.
18. Use recognizable AI-tool icon treatment for connector cards, allowlist rows, connection rows, and OAuth consent identity when possible. Icons should help users distinguish ChatGPT/OpenAI Apps, Claude.ai, Claude Code, Codex CLI/IDE, Gemini CLI, VS Code/Copilot MCP, and Generic MCP without relying on text alone.
19. Keep this revision as a targeted UX correctness repair pass, not a full connector architecture rewrite.

### Repair Implementation Steps

- [x] Add `claude_ai_connector` to the shared client-kind model, client registry, policy defaults, DTO labels, and tests.
- [x] Preserve `claude_code` as its own client kind and update labels/snippets so Claude.ai OAuth and Claude Code CLI/bearer setup are not conflated.
- [x] Add an AI client icon mapping used consistently across Admin MCP settings, user AI Connectors, connection history, Tool Catalog availability/details, and OAuth consent identity; prefer existing icon libraries or compact brand-adjacent glyphs rather than text-only rows.
- [x] Update OAuth authorization client-kind resolution so Claude.ai OAuth metadata maps to `vendor=anthropic`, `clientKind=claude_ai_connector`, and a user-facing `Claude.ai` label.
- [x] Rename or wrap the ChatGPT-specific consent component copy into generic AI connector authorization copy while keeping backward-compatible route behavior.
- [x] Add consent page client identity display for client id, detected client label, redirect URI, MCP resource, and requested permission groups.
- [x] Replace raw redirect-allowlist OAuth failures with a user/admin repair page or structured error state showing the exact callback URI to allowlist.
- [x] Add Admin MCP Redirect callbacks UI with built-in callbacks, custom allowlist rows, suggested callbacks, copy actions, quick-add, remove, validation, and client labels.
- [x] Add Admin MCP Tool groups UI showing Read, Draft workflow, Account management, and Posting & maintenance groups with enabled state, affected tool count, examples, and risk explanation.
- [x] Add Admin MCP Audit impact UI explaining which settings affect active connectors immediately, which settings require reconnect, and which actions revoke OAuth or bearer credentials.
- [x] Replace readiness/high-risk copy so warnings name the affected group or callback instead of saying only "High-risk tools."
- [x] Fix the user Connections query/UI so active Claude.ai and Claude Code connections are shown with correct client labels and auth modes.
- [x] Change the user Connections default view to active/pending/actionable rows and move revoked/non-actionable expired rows behind a History/Revoked view with client/status filters.
- [x] Add a user-facing cleanup/hide action for revoked connection history while preserving audit data.
- [x] Change Permissions to use active connections only and update empty states for no active permission-bearing connectors.
- [x] Redesign Tool Catalog rows to be compact and move long descriptions, schema, availability breakdown, and recent outcomes into a drawer/popover.
- [x] Rename Tool Catalog detail `Blocked` to `Unavailable for`, hide revoked connections from this operational breakdown, and display explicit blocker labels.
- [x] Limit Tool Catalog detail recent calls to the latest 5 and add a link to Activity prefiltered by tool.
- [x] Update Activity filtering/deep-link behavior as needed to support the Tool Catalog "view all calls for this tool" path.
- [x] Update docs/runbook setup guidance for ChatGPT/OpenAI Apps, Claude.ai, Claude Code, Codex CLI/IDE, Gemini CLI, VS Code/Copilot MCP, and Generic MCP.
- [x] Update web unit tests for Admin MCP settings, consent/repair states, user Connections/Permissions, Tool Catalog drawer/popover, and Activity deep links.
- [x] Update API/integration tests for Claude.ai client-kind detection, redirect allowlist behavior, connection listing, revoked cleanup/hiding, and permission filtering.
- [x] Run `/aaa` or equivalent E2E updates for the affected OAuth repair, Admin MCP, user Connections, Permissions, Tool Catalog, and Activity flows.

### Revision Out Of Scope

- New inline widgets for Claude.ai.
- Full Admin Settings redesign outside the MCP policy area.
- Full audit/export console.
- Dedicated per-tool pages.
- New live smoke automation framework for external AI clients.
- Hard deletion of audit history.
- Reopening the all-in-one MCP server architecture decision.

### Revision Evidence

- 2026-06-28 documentation verification and update:
  - `sed -n '240,360p' docs/002-operations/runbook.md`
  - `sed -n '1,180p' apps/api/src/mcp/clientRegistry.ts`
  - `sed -n '720,780p' apps/web/components/settings/AiConnectorsSettingsClient.tsx`
  - `sed -n '2140,2175p' libs/shared-types/src/index.ts`
  - Verified current shipped client kinds are `chatgpt_app`, `claude_code`, `codex_cli`, `gemini_cli`, `copilot_mcp`, and `generic_mcp`; no `claude_ai_connector` exists yet.
  - Updated the runbook MCP section to distinguish shipped ChatGPT OAuth, shipped bearer-fallback clients, and the still-pending Claude.ai repair path with its expected callback URI.
- 2026-06-28 repair-scope implementation audit:
  - `rg -n "claude_ai_connector|Claude\\.ai|History/Revoked|Unavailable for|auth_callback|clientKind" apps/api apps/web libs docs`
  - `sed -n '190,290p' apps/web/test/components/admin/AdminSettingsClient-mcp.test.tsx`
  - `sed -n '1550,2165p' apps/web/components/settings/AiConnectorsSettingsClient.tsx`
  - This was the pre-repair audit that identified the missing implementation gaps before the current repair pass.
- 2026-06-28 repair-pass implementation evidence:
  - `npm run typecheck`
  - `npx vitest run test/components/connectors/ChatGptConnectorAuthorizeClient.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx test/components/admin/AdminSettingsClient-mcp.test.tsx` from `apps/web`
  - `npx vitest run test/unit/mcpConnectorLifecycle.test.ts test/unit/mcpOAuthClientMetadata.test.ts test/integration/mcp.integration.test.ts test/integration/mcp-oauth.integration.test.ts` from `apps/api`
  - `npx vitest run test/integration/postgres-migrations.integration.test.ts` from `apps/api` skipped because the managed Postgres precondition was unavailable in this shell.
  - `npx playwright test --config=tests/e2e/playwright.config.ts specs/ai-connectors-sharing-aaa.spec.ts specs/combined-ui-improvements-aaa.spec.ts --grep "ai connectors|admin mcp|ai-connectors"` from `apps/web` passed with 5 tests.
  - `git diff --check`
- 2026-06-28 local UI validation:
  - Browser screenshots were captured under `/tmp/vakwen-mcp-ui-validation` for desktop and mobile Settings -> AI Connectors, Admin MCP settings, Connect cards, Tool Catalog detail, and Activity views.
  - Verified no horizontal overflow on the redesigned desktop/mobile Admin MCP and AI Connectors surfaces.
  - Verified recognizable AI-tool icon treatment appears on Connect cards, Admin client allowlist rows/cards, OAuth consent identity, Tool Catalog availability/details, and history/connection surfaces.
  - Validation fixes applied during E2E hardening: replaced ambiguous text locators for `Tool groups` and Activity deep links with role-based locators; used selector-based UI waits for local Next.js validation instead of `networkidle`.
- 2026-06-28 full local gate evidence:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web -- --reporter=dot` passed.
  - `npm run test --prefix apps/api -- --reporter=dot` passed.
  - `npm run test:integration:full:host` passed against managed Postgres/Redis.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed on rerun; an earlier full-run drag reorder timeout passed in isolated rerun before the clean full rerun.
  - `npm run test:http --prefix apps/api` passed with 298 passed and 2 skipped.
  - `git diff --check` passed before the full-gate run; rerun before PR handoff.
