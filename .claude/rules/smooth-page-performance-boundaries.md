# Smooth Page Performance Boundaries

When adding or changing authenticated page loads, keep `AppShell` and route-owned data separate.

- `AppShell` may bootstrap only lightweight identity/navigation state: profile, locale, shared-owner/read-only context, notifications, command/search essentials, and global actions.
- Do not make `AppShell` or unrelated pages wait for `/dashboard/overview` or another route-owned endpoint.
- Each page must own one primary read model that renders first useful content. Put charts, quote/freshness, FX/reporting overlays, and richer status/actions behind secondary or enrichment reads.
- Prefer explicit route-primary endpoints (`/dashboard/primary`, `/portfolio/primary`, etc.) and explicit enrichment endpoints over broad compatibility reads. Compatibility endpoints such as `/dashboard/overview`, `/portfolio/page-data`, and `/ai/connectors` may remain for older callers, but new route-primary UI must not depend on them.
- Ticker-detail routes may reuse `/dashboard/primary` for holding/account context, but must not bootstrap from dashboard enrichment or compatibility dashboard overview reads.
- Server-provided initial primary data should hydrate route-owned client hooks immediately; secondary enrichment may refresh after first paint and replace stale/cached market data without blanking the primary UI.
- When a route-primary payload already contains shell-level account or fee-profile config, pass it into `AppShell` as initial config instead of triggering an immediate duplicate shell fetch on first paint.
- Server-provided shell or route seeds are valid only for the current shared-owner context. Context switches must refresh or discard seeded route data, shell config, and command/search indexes before showing normal content for the new owner.
- Hot route-primary reads must emit `Server-Timing` and structured duration logs so browser-visible waits can be correlated with backend work.
- Portfolio-context reads must use `contextUserId`, not session-only identity. Session-owned surfaces such as `/profile` stay session-scoped.
- Preserve visible content during refreshes; use local skeletons or pending states instead of blanking the shell.

Deeper contract: `docs/001-architecture/web-frontend.md` "Smooth Page Performance Baseline", `docs/001-architecture/backend-db-api.md` "Timing instrumentation contract", and `docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md`.
