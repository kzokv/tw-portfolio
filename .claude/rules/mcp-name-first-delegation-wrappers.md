# MCP Name-First Delegation Wrappers

When MCP tools are meant for ChatGPT/model-facing delegated writes, expose a human selector surface instead of raw persistence IDs.

## Required Pattern

- Use portfolio selectors shaped like `{ label, email? }`; do not require `portfolioContextUserId` on model-facing write tools.
- Use account names, draft batch labels, and row numbers as model-facing selectors. Resolve internal IDs server-side.
- Reject duplicate or ambiguous human names instead of falling back to account IDs.
- Keep internal IDs out of `content` and `structuredContent`; place them only in `_meta` when widgets or internal bridges need them.
- Preserve low-level ID-heavy handlers for app/widget compatibility, but mark lifecycle tools app/widget-visible only through MCP metadata when they should not be model-planned.
- Add deterministic `confirmationSummary` and `confirmationDigest` to model-facing write previews. Commit tools must recompute from canonical current state and reject stale or mismatched digests.
- Keep direct posted transaction mutation tools out of model-facing delegation unless the product scope explicitly approves them; prefer the existing draft -> review -> confirm/post flow.

## Why

The MCP name-first delegation scope showed that delegated portfolio control fails at the user-experience boundary when ChatGPT asks for account IDs or context UUIDs. Users know portfolio/account names, not internal IDs. Name-first wrappers also keep widget-compatible ID handlers available while giving the model a safer planning surface with confirmation digests.

## How to Apply

When adding a delegated MCP write workflow, create or update model-facing wrappers and tests for:

1. human selector resolution and ambiguity errors
2. delegated capability denial
3. ID-free visible payloads
4. stale confirmation digest rejection
5. legacy low-level handler compatibility and metadata visibility
