---
name: vitest-alias-order
description: More specific package aliases must come before less specific ones in vitest.config.ts to prevent prefix clobbering
type: feedback
---

In `apps/web/vitest.config.ts`, always list more-specific aliases BEFORE less-specific ones. The `@tw-portfolio/config` alias is a prefix of `@tw-portfolio/config/web` and `@tw-portfolio/config/test`. If the bare alias appears first, it consumes the subpath and causes ENOTDIR errors.

**Why:** Vite/Vitest processes string aliases in object insertion order (first match wins). `@tw-portfolio/config` matches `@tw-portfolio/config/web` as a prefix, replacing it to `libs/config/src/index.ts/web` — a non-existent path.

**How to apply:**
- Alias order must be: `config/test`, `config/web`, then `config` (bare) last
- When adding new `@tw-portfolio/config/*` subpath aliases, insert them before the bare `@tw-portfolio/config` entry
- Same rule applies to any package with subpath exports that share a prefix
