# CashLedgerClient act() Warnings in Web Unit Tests

`npm run test --prefix apps/web` (vitest with jsdom) emits `Warning: An update to CashLedgerClient inside a test was not wrapped in act(...)` from `apps/web/features/cash-ledger/components/CashLedgerClient.tsx:97` during the `CashLedgerClient pagination` describe block. These are cosmetic — all tests pass cleanly.

**Do not flag, investigate, or attempt to suppress these warnings during PR review.** Treat them like the Radix `useLayoutEffect` warnings (see `radix-useLayoutEffect-jsdom.md`) — known-noisy stderr from a pre-existing async-state-update pattern that does not affect test outcome.

## Why they appear

The component issues a `fetch` (or equivalent async data load) inside a `useEffect`. The promise resolves AFTER the test's last `await` returns and the synchronous assertions complete. The late `setState` lands during teardown, outside any `act(...)` boundary, so React warns that it can't tell whether the test "saw" the update.

The tests still pass because the assertions exercise pre-fetch state (e.g., presence of the pagination chrome) — the late state update is genuinely invisible to the assertion path.

## When to fix vs ignore

- **Ignore** during PR review when the warnings are limited to `CashLedgerClient` and the affected tests are green. They are not a failure signal.
- **Fix** only if you are adding new tests in the same file AND the assertion depends on post-fetch state — in that case wrap the action or use `waitFor`:
  ```ts
  await waitFor(() => expect(screen.getByText("...")).toBeInTheDocument());
  // or
  await act(async () => { await user.click(nextButton); });
  ```
- **Do NOT** silence the warning globally (e.g., via `console.error` mock in `setup.ts`). Global suppression would also hide genuine `act()` warnings from future regressions.

## How to apply

When reviewing web unit test output, skip these specific stderr lines. They appear from `CashLedgerClient.tsx:97` (last touched in KZO-168 — the FX transfer transaction type work, not introduced by any later ticket). They do not appear in production and are not a code-quality signal.

## Related

- `.claude/rules/radix-useLayoutEffect-jsdom.md` — same pattern for Radix Tooltip's `useLayoutEffect` SSR warning. Both are jsdom + vitest cosmetic noise; both should be skipped, not suppressed.
