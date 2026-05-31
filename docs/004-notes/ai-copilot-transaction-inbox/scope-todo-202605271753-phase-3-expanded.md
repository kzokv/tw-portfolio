---
slug: ai-copilot-transaction-inbox-phase-3-expanded
source: scope-grill
created: 2026-05-27
tickets: [KZO-225, KZO-226, KZO-227, KZO-228, KZO-229]
required_reading:
  - docs/004-notes/ai-copilot-transaction-inbox/grill-wrap-up.md
  - docs/004-notes/ai-copilot-transaction-inbox/kzo-208-mcp-auth-deeplink-spike.md
  - docs/004-notes/ai-copilot-transaction-inbox/kzo-209-data-model-spike.md
  - docs/004-notes/ai-copilot-transaction-inbox/mcp-oauth-chatgpt-scope-lock.md
superseded_by: null
---

# Todo: AI Copilot Transaction Inbox Phase 3 Expanded

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Phase 3 runs on branch `codex/ai-copilot-phase-3` in worktree `/Users/lume/repos/tw-portfolio/.worktrees/ai-copilot-phase-3`.
2. KZO-225 and KZO-226 are expanded release-gate coverage for the full Phase 3 feature set.
3. KZO-227 ships a ChatGPT Apps UI component for transaction draft import, review, row edit, archive/delete, handoff, and guarded posting.
4. KZO-228 is revised from direct Vakwen uploads to connector-mediated CSV/image/PDF extraction. Vakwen does not expose an in-app raw upload endpoint in this phase.
5. KZO-229 is deferred as an architecture note. In-app BYO provider keys, platform AI inference, and local LLM endpoints are out of implementation scope for this pass.
6. CSV, image, and PDF source files are handled through the ChatGPT/AI connector path. ChatGPT/model orchestration performs extraction; Vakwen receives structured candidates plus capped provenance only.
7. Vakwen stores no raw CSV/image/PDF files. Store capped snippets, file/source metadata, row mappings, extraction metadata, provenance, and audit events only.
8. ChatGPT component file handling is ephemeral by default. Do not save selected/uploaded files to the user's ChatGPT file library by default.
9. ChatGPT component assets live in `apps/web`. `apps/api` remains the MCP/OAuth/tool server.
10. The component is a public shell with no Vakwen web-session dependency and no direct Vakwen API fetches. It receives state from MCP tool results and mutates through the MCP Apps bridge only.
11. Use the Apps SDK decoupled pattern: data/mutation tools return tool results; render tools return widget templates.
12. The connector requests draft-management scopes by default: `portfolio:mcp_read`, `transaction_draft:create`, `transaction_draft:edit`, `transaction_draft:archive`, and `transaction_draft:delete`.
13. `transaction:write` is not requested by default. It is an advanced consent/settings opt-in, requires fresh auth/reconsent to enable, and can be disabled by admin MCP policy.
14. ChatGPT posting is allowed only through the new `post_transaction_draft_rows` MCP tool and only when `transaction:write` is granted.
15. `post_transaction_draft_rows` posts only selected rows that are currently `ready`, requires expected batch/row versions, requires an idempotency key, and re-runs deterministic validation before writing.
16. ChatGPT posting uses the canonical Vakwen transaction creation path and must trigger the same accounting guards, idempotency, replay, snapshots, market-data backfill, notifications/SSE, draft row state changes, and permanent audit as Vakwen UI posting.
17. ChatGPT posting is all-or-nothing for selected rows. If any selected row fails revalidation, no rows post and the response returns current row-level errors/state.
18. Confirmation friction matches risk: 1-5 lower-value rows use an explicit confirmation button; 6+ rows or batches above the configured high-value threshold require typed `POST {N} TRADES`.
19. Shared-portfolio posting is allowed only if both connector permissions and owner-granted share capabilities include `transaction:write`. Audit must name the connected user and owner portfolio context.
20. Final posting is no longer Vakwen-only, but no normal draft mutation may bypass the high-friction `transaction:write` posting path.
21. `post_transaction_draft_rows` returns a compact structured result: batch id/version, posted row ids, created transaction ids, remaining unresolved rows, confirmation totals, Vakwen deep link, and audit/event ids if useful. Fetch refreshed batch detail separately.
22. ChatGPT component E2E uses a mocked `window.openai` bridge harness in Playwright. No live ChatGPT dependency is required in CI.
23. Add an optional manual ChatGPT smoke-test runbook/checklist for post-merge validation.

## Implementation Steps

- [x] Update Linear ticket descriptions/comments for KZO-225, KZO-226, KZO-227, KZO-228, and KZO-229 with this locked scope.
- [x] Add or update shared DTO/types for ChatGPT component render state, connector-mediated import provenance, compact posting results, and `post_transaction_draft_rows` inputs.
- [x] Add MCP render-tool support for the ChatGPT transaction draft component using a stable `apps/web` component resource URI.
- [x] Add connector-mediated import candidate submission contract for CSV/image/PDF sources. Accept structured candidates plus capped provenance only; reject raw source-file payloads.
- [x] Add row/source provenance caps and validation for connector-mediated import metadata.
- [x] Add `post_transaction_draft_rows` MCP tool with `transaction:write` enforcement, expected versions, idempotency key, deterministic revalidation, canonical posting path reuse, and compact result shape.
- [x] Add `transaction:write` admin policy support if the existing policy surface cannot globally disable it.
- [x] Add `transaction:write` advanced opt-in to ChatGPT consent and Settings -> AI Connectors, off by default and requiring fresh auth/reconsent before enablement.
- [x] Ensure component-origin tool calls are audited as MCP actions with `source = chatgpt_component` or equivalent durable source metadata.
- [x] Implement the ChatGPT component in `apps/web`: import state, review state, row edit, exclude/reinclude/reject, archive/delete, guarded post, and Vakwen deep-link handoff.
- [x] Add a local Playwright test harness route/page for the component with a mocked `window.openai` bridge.
- [x] Update AI Inbox/Vakwen UI only where needed to show connector-mediated source/provenance and posted-from-ChatGPT outcomes.
- [x] Update docs/runbook with optional live ChatGPT smoke testing and current component setup notes.
- [x] KZO-225: add API/MCP tests covering policy gates, share capabilities, read tools, import candidate submission, preflight, batch creation, draft mutations, `post_transaction_draft_rows`, audit, access logs, conflict handling, duplicate blocking, negative-inventory blocking, and shared-portfolio posting gates.
- [x] KZO-225: include memory-backed and relevant Postgres-backed integration coverage where migrations or persistence contracts are touched.
- [x] KZO-226: add Playwright E2E coverage for AI Inbox, ChatGPT component harness, connector settings, share permissions, admin MCP settings, notifications/badges, deep links, connector-mediated import, row edit/archive/delete, and guarded posting.
- [x] KZO-226: include viewer/read-only and shared-portfolio permission cases.
- [x] Verify focused test scopes for the KZO-226 gap-fix branch.
- [ ] Run the full eight-suite repo gate before merge/release.

## Gap-Fix Verification

- KZO-225 Postgres coverage includes `apps/api/test/integration/postgres-migrations.integration.test.ts`, including the regression that inserts posted trade events before linking `confirmed_trade_event_id`.
- KZO-226 focused E2E coverage now includes `apps/web/tests/e2e/specs/chatgpt-widget-aaa.spec.ts`, `apps/web/tests/e2e/specs/ai-inbox-aaa.spec.ts`, and `apps/web/tests/e2e/specs/ai-connectors-sharing-aaa.spec.ts`.
- Focused checks run on the gap-fix branch: touched-file ESLint, `npx tsc --noEmit -p apps/web/tsconfig.json`, ChatGPT widget harness E2E, AI Inbox E2E, and AI connector/sharing/admin MCP E2E.

## Out Of Scope

- [ ] In-app BYO OpenAI/Anthropic/Gemini provider keys.
- [ ] Platform-paid in-app AI inference.
- [ ] Local LLM endpoint support.
- [ ] Direct Vakwen raw file upload endpoint.
- [ ] Vakwen raw CSV/image/PDF storage, preview, or deletion UI.
- [ ] Live ChatGPT automation as a required CI gate.
- [ ] Admin impersonation over MCP.
- [ ] Public anonymous share data over MCP.
- [ ] Any non-draft transaction write path that bypasses `post_transaction_draft_rows`.

## Documentation Landing Points

- Evergreen operations/setup/smoke-test guidance lives in `docs/002-operations/runbook.md`.
- The ChatGPT Apps component public route is `${app.appBaseUrl}/connectors/chatgpt/transaction-draft`.
- The local mocked bridge harness route is `${app.appBaseUrl}/connectors/chatgpt/transaction-draft/harness`.
- The render-tool entrypoint is `get_transaction_draft_batch_component`.
- Guarded MCP posting uses `post_transaction_draft_rows`; `transaction:write` remains advanced opt-in and off by default.

## Open Items

- [x] Confirm exact component resource URI and deployment origin before implementation. Implemented as `${app.appBaseUrl}/connectors/chatgpt/transaction-draft`.

## References

- Linear project: https://linear.app/kzokv/project/ai-copilot-and-transaction-inbox-dbd17778ac06
- KZO-225: https://linear.app/kzokv/issue/KZO-225
- KZO-226: https://linear.app/kzokv/issue/KZO-226
- KZO-227: https://linear.app/kzokv/issue/KZO-227
- KZO-228: https://linear.app/kzokv/issue/KZO-228
- KZO-229: https://linear.app/kzokv/issue/KZO-229
- OpenAI Apps SDK UI bridge: https://developers.openai.com/apps-sdk/reference#mcp-apps-ui-bridge
- OpenAI Apps SDK component capabilities: https://developers.openai.com/apps-sdk/reference#capabilities
- OpenAI Apps SDK decoupled pattern: https://developers.openai.com/apps-sdk/build/chatgpt-ui#decoupled-pattern
- ChatGPT component mockup HTML: docs/004-notes/ai-copilot-transaction-inbox/mockups/chatgpt-transaction-draft-component.html
- ChatGPT component mockup screenshot: docs/004-notes/ai-copilot-transaction-inbox/mockups/chatgpt-transaction-draft-component.png
