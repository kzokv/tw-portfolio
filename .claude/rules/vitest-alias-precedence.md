# Vitest Alias Resolution Order

Vitest alias resolution is ordered — more specific package aliases must precede less specific ones. The first matching alias wins, so prefix clobbering occurs if a short alias appears before a longer one.

**The problem:**
```ts
// ❌ Wrong order — "config" matches "config/web" and "config/test"
alias: {
  "@tw-portfolio/config": "libs/config/src/index.ts",
  "@tw-portfolio/config/web": "libs/config/src/env-web.ts",
  "@tw-portfolio/config/test": "libs/config/src/test.ts",
}

// Result: import from "@tw-portfolio/config/web" resolves to
// "libs/config/src/index.ts/web" — non-existent, ENOTDIR error
```

**Correct order:**
```ts
// ✅ Correct — specific aliases before general
alias: {
  "@tw-portfolio/config/test": "libs/config/src/test.ts",
  "@tw-portfolio/config/web": "libs/config/src/env-web.ts",
  "@tw-portfolio/config": "libs/config/src/index.ts",
}
```

**Why:** Vite processes string aliases in object insertion order. First match wins — `@tw-portfolio/config` as a prefix matches before `@tw-portfolio/config/web` can.

**How to apply:**
- In `apps/web/vitest.config.ts`, always list longer subpath aliases (`config/test`, `config/web`) before the bare `config` alias
- When adding new `@tw-portfolio/config/*` subpath aliases, insert them before the bare alias
- Same rule applies to any package with subpath exports that share a prefix

**Pattern (for any subpath package):**
```ts
alias: {
  // Longer paths first
  "@package/subpath/a": "...",
  "@package/subpath/b": "...",
  // Shorter/general path last
  "@package": "...",
}
```
