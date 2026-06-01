# Smooth Page Performance Boundaries

When adding or changing authenticated page loads, keep `AppShell` and route-owned data separate.

- `AppShell` may bootstrap only lightweight identity/navigation state: profile, locale, shared-owner/read-only context, notifications, command/search essentials, and global actions.
- Do not make `AppShell` or unrelated pages wait for `/dashboard/overview` or another route-owned endpoint.
- Each page must own one primary read model that renders first useful content. Put charts, quote/freshness, FX/reporting overlays, and richer status/actions behind secondary or enrichment reads.
- Hot route-primary reads must emit `Server-Timing` and structured duration logs so browser-visible waits can be correlated with backend work.
- Portfolio-context reads must use `contextUserId`, not session-only identity. Session-owned surfaces such as `/profile` stay session-scoped.
- Preserve visible content during refreshes; use local skeletons or pending states instead of blanking the shell.

Deeper contract: `docs/001-architecture/web-frontend.md` "Smooth Page Performance Baseline", `docs/001-architecture/backend-db-api.md` "Timing instrumentation contract", and `docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md`.
