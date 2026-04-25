# OAuth E2E Seeds: Use `seedAsBrowser`, Not `testUser.userId`, AND Seed BEFORE Navigation

In `specs-oauth/` tests, two distinct user identities exist for any given test:

1. **Browser session user** — set by the OAuth fixture's `mintSessionCookieValue` (no body), which calls `/__e2e/oauth-session` and resolves to the default `e2e-ci-google-sub-001` account. This is the user the BROWSER reads/writes as.
2. **`testUser.userId`** — set by `buildE2EUserId(testInfo)`, a per-test synthetic ID. This is what `seedUserPreferences(seedSession.cookieHeader, testUser.userId, ...)` writes to.

These are **different users in the persistence backend**. A seed targeted at `testUser.userId` does NOT land on the user the browser is reading. Any UI assertion that depends on observing the seeded state will fail (or pass for the wrong reason — silently asserting against unrelated state).

This is structurally different from the dev_bypass case covered by `e2e-seed-testuser-userid.md`. In dev_bypass, the `tw_e2e_user` cookie carries `testUser.userId` and the API forwards it via `x-user-id`, so passing `testUser.userId` to seeds is correct. In OAuth, the session cookie resolves server-side to a different identity — passing `testUser.userId` is wrong.

## The pattern

For any OAuth E2E spec that needs the BROWSER to OBSERVE seeded state:

```ts
async function seedAsBrowser(
  page: Page,
  preferences: Record<string, unknown>,
): Promise<void> {
  const cookieHeader = await getTestUserCookieHeader(page);
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/seed-user-preferences"), {
      headers: { cookie: cookieHeader },
      data: { preferences },  // NO userId — endpoint resolves from cookie
    });
    if (!response.ok()) {
      throw new Error(`seed failed: ${response.status()} ${await response.text()}`);
    }
  });
}
```

The OAuth fixture (`libs/test-e2e/src/fixtures/sessionBase.ts`) pre-installs the session cookie on `page.context()` BEFORE the test body runs:

```ts
page: async ({ page, request }, use) => {
  const cookieValue = await mintSessionCookieValue(request, config.endpoint);
  await page.context().addCookies([{ name: cookieName, value: cookieValue, ... }]);
  await use(page);
}
```

So `getTestUserCookieHeader(page)` works at the very top of a test body — no navigation required.

## Seed BEFORE navigation

Components that fetch state on mount (`<SortableCardGrid>`, `<CustomizeRangesPopover>`, anything reading `/user-preferences` in `useEffect([], ...)`) read state ONCE at mount. If the test seeds AFTER navigation, the grid has already cached prior shared-user state. The fix is order-of-operations:

```ts
test("...", async ({ appShell, page }) => {
  // 1. Read cookie from fixture-installed context (no nav needed)
  const cookieHeader = await getTestUserCookieHeader(page);

  // 2. Seed via the BROWSER's user
  await seedAsBrowser(page, { cardOrder: { transactions: [...] } });

  // 3. THEN navigate — grid mount fetches the seeded value
  await appShell.actions.navigateToRoute("/transactions");

  // 4. Drag / assert
  ...
});
```

**Symptoms when violated:**
- Test passes alone, fails in the full suite (parallel workers writing the shared default user).
- Test asserts on canonical order even though seed wrote a non-canonical order — the grid mounted on stale shared-user state.
- "Sibling preservation" assertions fail because the browser's user has nothing to preserve (seed landed on a different user entirely).

**Why:** Discovered as a Codex P2 in KZO-162. Three new specs (`transactions-card-reorder-aaa.spec.ts`, `portfolio-card-reorder-aaa.spec.ts`, the new `[card-D]` test in `card-reorder-aaa.spec.ts`) initially seeded after navigation OR seeded `testUser.userId` while reading from the browser's session. Both bugs masked each other and produced flaky/invalid assertions.

**How to apply:**

1. When writing a new `specs-oauth/` test that seeds preferences (or any user-scoped state) and then asserts the BROWSER sees it, use `seedAsBrowser(page, ...)` — not `seedUserPreferences(seedSession.cookieHeader, testUser.userId, ...)`.
2. If the asserted UI fetches on mount (any `useEffect` GET), call `seedAsBrowser` BEFORE `navigateToRoute`. The fixture's cookie is in `page.context()` from test-body line 1.
3. The unified pattern: `getTestUserCookieHeader → seed → navigate → act → assert`.
4. `seedUserPreferences(..., testUser.userId, ...)` is still correct in `specs/` (dev_bypass) — see `e2e-seed-testuser-userid.md` for that direction.

**Companion rules:**
- `e2e-seed-testuser-userid.md` — dev_bypass seed-identity pattern (different mechanics, same principle).
- `playwright-oauth-cookie-patterns.md` — OAuth cookie domain scoping (`localhost` vs `127.0.0.1`).
- `playwright-request-cookie-jar-isolation.md` — `withFreshContext` pattern.
