---
name: market-data-platform-progress-pointer
description: Pointer — Linear is authoritative for ticket-completion state; this entry tracks only durable known-gaps that don't fit a single ticket
type: reference
---

## Why this is a pointer, not a snapshot

Earlier versions of this memory tracked the full Market Data Platform ticket-completion table inline. That snapshot drifted by an entire epic (KZO-141 sharing/admin) within ~2 weeks and required curation overhead per PR. Linear already maintains this state authoritatively.

**For ticket completion state:** check the Linear board (project: International Markets — US & AU Expansion) and `git log --oneline dev` for recent merges.

**Recent active epics (high-level orientation only — not exhaustive):**
- KZO-141 (sharing, invites, admin portal, anonymous tokens, retention) — done by 2026-04-21
- KZO-167+ (account-shape extension: defaultCurrency, accountType, multi-account creation, reporting currency) — done by 2026-04-30
- KZO-169+ (multi-market: composite-PK migration, market_code on instruments/daily_bars/dividend_events, transaction-form market_code selector) — KZO-169 done 2026-05-01
- KZO-170 / KZO-172 (US / AU instrument ingestion) — KZO-170 done 2026-05-01; KZO-172 done 2026-05-05 (backend slice; UI follow-up KZO-188)
- KZO-185 (pgboss back-compat removal after KZO-169 queue drain) — done 2026-05-01

Use `mcp__linear__list_issues` (project filter) for the live state.

## Durable known gaps

These predate any individual ticket and remain open until explicitly scoped:

- **Backup/restore for `market_data` schema**: the topology ADR (`docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`) describes post-ingest backup automation (pg_dump from prod, auto-restore to dev, manual scp to local). No ticket has scoped this. Will need a separate ops ticket — track here until then.
- **Notification i18n repo-wide pass**: KZO-151 covered sharing notifications; remaining notification surfaces still emit English-only. No ticket has scoped the catch-up sweep.
- **Legacy test drift under `apps/api/test/{integration,unit}/`**: ~14 pre-existing type errors surfaced when the test tsconfig was briefly widened (during KZO-145 work). Cleanup ticket pending.

## How to apply

- When a user asks "what's done in market-data?": consult Linear, not this file.
- When a user asks "what's the next backlog item?": Linear board priority.
- When the question is about a known durable gap (backup/restore, i18n sweep, legacy test drift): the bullet list above is the canonical reminder set. Add to this list when scoping a future ticket would be premature but the gap is real and forgettable.
