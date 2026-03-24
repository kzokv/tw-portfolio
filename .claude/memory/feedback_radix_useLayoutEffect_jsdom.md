---
name: radix-useLayoutEffect-jsdom-warnings
description: "useLayoutEffect SSR warnings in web unit tests are cosmetic noise from Radix UI + jsdom, not a bug"
type: feedback
---

Web unit tests (`npm run test --prefix apps/web`) emit `useLayoutEffect` SSR warning stack traces from `@radix-ui/react-tooltip` (`Tooltip`, `Presence`, `TooltipPortal`). These are cosmetic — all tests pass cleanly.

**Why:** vitest uses `jsdom` which React treats as a server-like environment. `useLayoutEffect` has no SSR equivalent, so React warns. The warnings fire during tests for `AddTransactionCard` → `TooltipInfo` → Radix `Tooltip`. This is a well-known Radix UI + vitest/jsdom interaction, not introduced by any PR.

**How to apply:** Ignore these warnings when reviewing test output. They do not indicate failures, do not appear in production, and do not need fixing. Suppression options exist (mock Radix, monkey-patch useLayoutEffect) but are fragile and reduce coverage fidelity — not recommended.
