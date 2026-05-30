# AI Copilot & Transaction Inbox

## Gap Check Results

- Critical gaps resolved:
  - V1 screenshot/PDF support means users process files inside ChatGPT; Vakwen stores structured draft and audit metadata only, not raw files.
  - Every MCP/UI draft row edit re-runs deterministic preflight. Blocking issues reject the edit and return row-level errors/current state.
  - Shared-portfolio MCP/draft support requires new owner-controlled share capabilities. Without that capability model, shared MCP is not shipped.
- Non-critical gaps:
  - ChatGPT app UI component is follow-up scope; v1 uses MCP tools plus deep links into Vakwen.
  - Exact ChatGPT/MCP protocol details are validated by the first technical spike.
  - Every UI-related Linear ticket requires a medium-fidelity Vakwen-style screenshot before issue creation.

## Product Direction

V1 is ChatGPT/MCP-first, not in-app LLM-first.

Vakwen exposes a hosted HTTPS MCP server from `apps/api`. ChatGPT performs language, table, image, and PDF understanding. Vakwen owns authentication, permissions, deterministic validation, duplicate checks, draft persistence, audit, notifications, and final posting in the web app.

No OpenAI API key is required for v1 runtime because Vakwen does not call an LLM in-app. Future phases may add BYO provider keys, platform AI with quotas, and local LLM endpoints.

## V1 Scope

- ChatGPT/MCP connector for authenticated Vakwen users.
- Tools plus deep links back to Vakwen; no ChatGPT app UI component in v1.
- Portfolio read tools for descriptive analytics only; no investment advice.
- Instrument lookup/search across TW/US/AU.
- Transaction draft workflow for trades only: BUY/SELL.
- Bulk draft import up to 200 candidate rows.
- Draft lifecycle over MCP behind connector toggles, except final canonical posting.
- Final posting happens only inside Vakwen after user review and risk-based confirmation.
- AI Inbox lives inside the Transactions page as a top-level tab.
- Settings -> AI Connectors manages connector permissions, expiry, revocation, recent access, and tool toggles.
- Admin settings manage deployment-wide MCP controls, limits, rate limits, and retention.
- Shared portfolios require owner-granted AI/MCP share capabilities.

## Explicitly Out Of V1

- Vakwen direct raw file upload/OCR/retention.
- In-app AI using OpenAI/Anthropic/Gemini API keys.
- Platform-paid AI inference.
- Local LLM endpoint.
- ChatGPT app UI component.
- MCP final transaction confirmation/posting.
- Dividends, cash ledger movements, FX transfers, and corporate actions as draftable records.
- User/admin/settings writes over MCP.
- Public anonymous share data over MCP.
- Admin impersonation over MCP.
- Investment, tax, suitability, buy/sell/hold, target-price, or rebalancing advice.

## MCP Tools

Read:

- `get_portfolio_overview`
- `get_holdings`
- `get_performance`
- `get_recent_transactions` with date-range caps
- `get_dividends_overview`
- `get_quote_freshness`
- `get_cash_balance_summary`
- `search_instruments`

Draft:

- `get_transaction_draft_template`
- `preflight_transaction_draft_candidates`
- `create_transaction_draft_batch`
- `list_transaction_draft_batches`
- `get_transaction_draft_batch`
- `update_transaction_draft_rows`
- `exclude_transaction_draft_rows`
- `reinclude_transaction_draft_rows`
- `reject_transaction_draft_rows`
- `archive_transaction_draft_batch`
- `delete_unconfirmed_transaction_draft_batch`

Disabled/future capabilities:

- `confirm_transaction_draft`
- `delete_transaction`
- `edit_posted_transaction`
- `manage_accounts`
- `change_settings`

## Permission Model

Access is gated by:

1. Admin deployment policy.
2. Connector connection group toggle.
3. Individual advanced tool toggle.
4. Portfolio/share capability.
5. Runtime row/batch state guard.

Share capabilities are separate from global user role. Presets use advanced capabilities:

- Viewer: app read only.
- AI-enabled viewer: app read + MCP read.
- Draft collaborator: app read + MCP read + draft create/edit.
- Editor: draft + transaction write.

`portfolio:mcp_read` defaults off for existing and new shares. Owners must explicitly enable AI connector access for shared portfolios.

`transaction_draft:*` and `transaction:write` are separate capabilities.

Global admins do not get MCP superuser access. MCP operates as the connected user only.

## Draft Lifecycle

Batch rules:

- One portfolio context per batch.
- Multiple resolved active accounts are allowed within that portfolio.
- Batch creation is all-or-nothing after preflight.
- Maximum 200 candidate rows.
- Metadata caps:
  - source snippet: 500 chars per row
  - unsupported row snippet: 500 chars
  - warnings: max 10 per row
  - batch source label/filename: 200 chars
  - batch note: 1,000 chars
- Unconfirmed batches auto-archive after 90 days.
- Never-confirmed batches may be deleted.
- Partially/fully confirmed batches may only be archived/hidden.
- Confirmed draft rows remain visible forever as audit history.

Row states:

- `needs_clarification`
- `pending_validation`
- `ready`
- `invalid`
- `duplicate_blocked`
- `excluded`
- `rejected`
- `confirmed`
- `unsupported`

MCP/UI draft edits use optimistic row-level concurrency. Batch delete/archive requires expected batch version and state checks.

## Validation Rules

Required candidate fields:

- `portfolioContextId`
- `accountId` or uniquely resolvable account name
- `type`: `BUY | SELL`
- `ticker`
- `marketCode`: `TW | US | AU`
- `quantity`
- `unitPrice`
- `priceCurrency`
- `tradeDate`

Optional fields:

- `tradeTimestamp`
- `bookingSequence`
- `isDayTrade`
- source-provided commission/tax
- note/source row reference

Allowed inference:

- market/currency from unambiguous account
- ticker casing/whitespace normalization
- `isDayTrade = false`

Must ask user:

- account ambiguity
- trade date
- side
- quantity
- price
- ambiguous ticker/instrument
- manual/conflicting fees

Blocking:

- exact duplicate transactions
- same-day duplicate collision without `tradeTimestamp` or `bookingSequence`
- unknown/unclassified instruments
- inactive/soft-deleted accounts
- negative-inventory SELL candidates
- ambiguous same-day ordering when order matters

Low model-reported confidence is warning-only.

Current quotes/freshness may be used for insights, but never to fill missing trade execution price.

## Posting

Final posting happens only in Vakwen UI.

Users can edit rows, re-run validation, exclude rows, and selectively confirm valid rows. Posting reuses the canonical manual transaction creation path and side effects: accounting guards, idempotency, replay, snapshots, and market-data backfill.

Risk-based confirmation:

- 1-5 rows: normal confirmation dialog.
- 6+ rows or TWD 1,000,000 equivalent total value: typed confirmation, e.g. `POST 23 TRADES`.
- Confirmation summary shows accounts, markets, gross value, fees/taxes estimate, and duplicate-check status.

Source-provided commission/tax is accepted, labeled, compared against calculated estimates, posted as manual/source-provided fees, and preserved on later edits unless the user explicitly recalculates.

## Connector Settings

Settings -> AI Connectors:

- per connector connection
- ChatGPT provider in v1
- grouped permissions plus advanced individual tool toggles
- parent groups are ceilings; advanced toggles can only narrow access
- last used, recent read access, durable actions, status, expiry, revoke
- inactivity expiry defaults to 90 days, user-configurable within admin bounds
- hosted bounds: 7-180 days
- self-hosted may allow `never` if admin permits
- expiry revokes access and requires reconnect
- in-app notifications at 7 days before expiry and when expired/revoked
- high-risk connector changes require fresh authentication where possible

Hosted uses OAuth-style connector authorization. Self-hosted supports scoped personal access token connector mode.

## Admin Controls

Admin settings include env-backed controls:

- MCP globally enabled/disabled
- allowed provider/client: ChatGPT only
- access-log retention days
- max draft rows per batch
- high-value typed-confirm threshold
- MCP read rate limits
- draft mutation rate limits
- inactivity expiry min/max/default

MCP rate limits key by connector connection + user, context-aware for reads. Auth also considers IP. Self-hosted defaults can be looser.

## Audit And Logs

Permanent audit:

- connector authorized/revoked/expired
- draft batch created
- draft row edits/exclusions/reincludes/rejections
- batch delete/archive
- final UI posting
- before/after for changed accounting fields, capped

Operational/recent access log:

- read tool name
- connector id
- user id
- portfolio context
- timestamp
- retained per admin setting

Verified provenance is stored separately from client-reported provenance.

## Implementation Order

1. ChatGPT/MCP protocol/auth/deep-link spike.
2. Data model design for connectors, share capabilities, draft batches/rows/audit/access logs, notifications, DTOs.
3. Database migrations and persistence contracts.
4. MCP plugin skeleton in `apps/api`.
5. Connector auth/session/scopes/rate-limits/audit.
6. Share capability expansion.
7. Portfolio read tools and access logging.
8. Draft template/preflight/create tools.
9. Draft lifecycle mutation tools with concurrency/audit.
10. Transactions page AI Inbox tab and batch list.
11. Draft batch review/edit UI.
12. Bulk confirmation UI and canonical posting integration.
13. Settings -> AI Connectors UI.
14. Share permission UI.
15. Admin MCP settings UI.
16. Notifications/SSE and Transactions badge.
17. Test suites: API/tool tests and web E2E with mocked MCP client.
18. Follow-up: ChatGPT app UI component.
19. Follow-up: direct Vakwen uploads/OCR/retention.
20. Follow-up: BYO/provider/platform/local LLM support.

## Mockups

UI tickets must include medium-fidelity Vakwen-style screenshots before ticket creation. Mockups live under:

`docs/004-notes/ai-copilot-transaction-inbox/mockups/`

