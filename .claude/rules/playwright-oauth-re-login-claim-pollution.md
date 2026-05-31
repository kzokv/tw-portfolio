# Playwright OAuth Re-Login: Claim Pollution Across Tests

When two Playwright tests in the same shared-server E2E suite call `makeDeterministicIdToken()` without overriding `sub`/`email`, they end up driving `resolveOrCreateUser` through the **same persisted user**. Any claim field that the resolver treats as "optional — update if present" will carry over from the first test to the second.

The canonical example is `providerPictureUrl`:

```ts
// apps/api/src/persistence/memory.ts — resolveOrCreateUser re-login path
existing.providerPictureUrl = claims.picture ?? existing.providerPictureUrl;
```

`claims.picture = undefined` on a re-login **preserves** the previous value. This is correct behavior for real OAuth (Google occasionally drops the picture claim; we don't want to wipe it), but it turns into test pollution when one test seeds a picture and a later test explicitly sets `picture: undefined` expecting a fresh user.

**The symptom:** the second test asserts "no `<img>` under the avatar button" and instead finds the first test's avatar image. Failure is flaky-looking — passes in isolation, fails in the full suite, usually passes on retry because Playwright's default retries trigger a fresh login flow that hits a different path.

**Rule:** when a Playwright test overrides an OAuth claim in a way that depends on *absence* (e.g. `picture: undefined`, `name: undefined`), also override `sub` and `email` so the test seeds a **fresh user** rather than re-logging an existing one.

```ts
// ❌ Wrong — reuses `profile-e2e-sub`; the persistence-layer `??` preserves the prior picture
await session.actions.seedOAuthSession(makeDeterministicIdToken({ picture: undefined }));

// ✅ Correct — fresh user, fresh state
await session.actions.seedOAuthSession(makeDeterministicIdToken({
  sub: "profile-e2e-no-picture-sub",
  email: "profile-e2e-no-picture@example.com",
  picture: undefined,
}));
```

**Why:** Discovered in the KZO-148 8-suite gate. `specs-oauth/profile-tab-aaa.spec.ts:94` (`avatar button shows initials when user has no picture`) failed in the full suite but passed in isolation because `specs-oauth/profile-tab-aaa.spec.ts:86` (`avatar button shows picture`) had seeded the picture on the same default-sub user immediately before. The pollution mechanism is `memory.ts:273`'s re-login `??` fallback.

**How to apply:** when writing or reviewing Playwright E2E tests that call `makeDeterministicIdToken(...)`:
1. If the test's assertion depends on an OAuth claim being **absent** or **cleared**, include `sub` and `email` overrides in the same token.
2. If the test's assertion depends on a claim being a specific value, either override `sub`/`email` for isolation or explicitly overwrite the field (passing a real value, not `undefined`).
3. The same rule applies to any other claim that flows through `resolveOrCreateUser`'s `claims.X ?? existing.X` pattern — currently `picture`, `name`, `displayName`.

Companion rule: `playwright-oauth-cookie-patterns.md` covers session-cookie scope issues for OAuth tests.
