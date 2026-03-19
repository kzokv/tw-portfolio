---
name: project_nextjs_proxy_convention
description: In Next.js 16 (used at v16.1.6), proxy.ts replaces the deprecated middleware.ts convention and is auto-discovered at build time
type: project
---

## Convention

Next.js 16 introduced `proxy.ts` as the replacement for the deprecated `middleware.ts` pattern for request proxying and middleware logic.

- **File location:** `apps/web/proxy.ts`
- **Auto-discovery:** Next.js discovers and applies it automatically at build time — no imports or wrapper needed
- **No middleware.ts required:** Do not add a `middleware.ts` file; it is deprecated in v16 and would conflict

## Project status

`apps/web/proxy.ts` is already correctly named and in place. This convention should be preserved when adding or modifying request-level middleware logic.
