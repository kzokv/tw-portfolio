# Radix UI useLayoutEffect Warnings in Web Unit Tests

`npm run test --prefix apps/web` (vitest with jsdom) emits `useLayoutEffect` SSR warning stack traces from `@radix-ui/react-tooltip` (`Tooltip`, `Presence`, `TooltipPortal`). These are cosmetic — all tests pass cleanly.

**Do not flag, investigate, or attempt to suppress these warnings.** Suppression options exist (mock Radix, monkey-patch `useLayoutEffect`) but are fragile and reduce coverage fidelity.

**Why:** vitest uses jsdom which React treats as a server-like environment. `useLayoutEffect` has no SSE equivalent, so React warns. This fires during tests for `AddTransactionCard → TooltipInfo → Radix Tooltip` and is a well-known Radix UI + vitest/jsdom interaction, not introduced by any PR.

**How to apply:** When reviewing web unit test output, skip these warning lines entirely. They do not indicate failures, do not appear in production, and are not a code quality signal.
