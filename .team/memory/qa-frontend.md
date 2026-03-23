# QA Frontend — Staged Memory (KZO-108 Phase 4-5)

## Phase 1: Test Coverage Checklist (Plan Only)

### A. `apps/web/test/features/auth/getSession.test.ts` — 17 assertion updates + 2 new tests

#### Assertion update verification
All `toEqual({ userId: "..." })` calls must be updated to `toEqual({ userId: "...", isDemo: false })`.
The design lists these specific lines: 111, 149, 185, 189, 193, 199, 205, 213, 219, 230.
Design says 17 total — verify the actual count after impl. Count with:
  `grep -n 'toEqual({ userId' apps/web/test/features/auth/getSession.test.ts`

Lines mapped to test cases:
- L111: oauth mode, validly-signed cookie → `{ userId: "google-sub-123", isDemo: false }`
- L149: oauth mode, userId contains dots → `{ userId: "numeric.sub.with.dots", isDemo: false }`
- L185: dev_bypass, plain cookie value → `{ userId: "user-1", isDemo: false }`
- L189: dev_bypass, trimmed whitespace → `{ userId: "user-1", isDemo: false }`
- L193: dev_bypass, absent cookie fallback → `{ userId: "user-1", isDemo: false }`
- L199: dev_bypass, empty cookie fallback → `{ userId: "user-1", isDemo: false }`
- L205: dev_bypass, no SESSION_SECRET → `{ userId: "user-1", isDemo: false }`
- L213: dev_bypass, tw_e2e_user cookie → `{ userId: "qa-user-1", isDemo: false }`
- L219: dev_bypass, URL-decoded tw_e2e_user → `{ userId: "qa-user-1", isDemo: false }`
- L230: requireSession, authenticated → `{ userId: "google-sub-123", isDemo: false }`

#### New test cases (2)
Must be added in a new describe block `"getSession (oauth mode) — demo prefix"`:
1. `returns { userId, isDemo: true } for demo-prefixed cookie`
   - Cookie: `demo:user-123.${hmacSign("demo:user-123", SECRET)}`
   - Expected: `{ userId: "user-123", isDemo: true }`
2. `returns { userId, isDemo: false } for non-demo cookie`
   - Cookie: `signCookie("user-123")`
   - Expected: `{ userId: "user-123", isDemo: false }`

Note: `signCookie` helper uses `${userId}.${hmacSign(userId, secret)}` — for demo tests, the HMAC
must be computed over the full payload `"demo:user-123"`, not just `"user-123"`.

---

### B. New files to verify exist

| File | Key checks |
|------|------------|
| `apps/web/app/api/demo/start/route.ts` | POST handler, no auth, forwards Set-Cookie, catches with 502 |
| `apps/web/components/DemoButton.tsx` | `data-testid="demo-sign-in-button"`, loading state, error `<p role="alert">`, sessionStorage.setItem("isDemo", "true") |
| `apps/web/tests/e2e/specs-oauth/auth-demo.spec.ts` | 8 scenarios (see below) |

---

### C. Modified files to verify

#### `apps/web/lib/auth.ts`
- `Session` interface has `isDemo: boolean` field
- oauth code path: after HMAC verify, check `userId.startsWith("demo:")` → `{ userId: userId.slice(5), isDemo: true }`
- dev_bypass code path: all three return branches return `isDemo: false`
- HMAC verification remains unchanged (operates on full payload)

#### `apps/web/lib/api.ts`
- `redirectToLogoutOn401`: checks `sessionStorage.getItem("isDemo")` before redirect
- If demo: removeItem + redirect to `/login?demoExpired=true`
- If not demo: existing `${API_BASE}/auth/logout` redirect

#### `apps/web/app/login/page.tsx`
- Imports `DemoButton` from `../../components/DemoButton`
- Imports `WebEnv` from `@tw-portfolio/config/web`
- `const showDemo = WebEnv.DEMO_MODE_ENABLED === "true"`
- Conditionally renders "or" divider + `<DemoButton>` when `showDemo`
- Shows demoExpired message when `searchParams.demoExpired` is truthy

#### `apps/web/app/dashboard/page.tsx`
- Passes `isDemo={session.isDemo}` to `<AppShell>`

#### `apps/web/components/layout/AppShell.tsx`
- `AppShellProps` has `isDemo?: boolean`
- Function signature: `({ section = "dashboard", isDemo = false })`
- Demo banner above TopBar: `data-testid="demo-banner"`, text "You're using a demo session."
- Banner only renders when `isDemo === true`

#### `apps/web/tests/e2e/playwright.oauth.config.ts`
- API server env block includes `DEMO_MODE_ENABLED: "true"`

#### Portfolio/transactions pages (if they render AppShell)
- `apps/web/app/portfolio/page.tsx`: passes `isDemo={session.isDemo}` to AppShell
- `apps/web/app/transactions/page.tsx`: passes `isDemo={session.isDemo}` to AppShell

---

### D. E2E Scenarios in `auth-demo.spec.ts`

All 8 must be present:

| # | Scenario | Key assertion |
|---|----------|--------------|
| 1 | Click demo button → session → /dashboard | `page.waitForURL("**/dashboard")` |
| 2 | Demo user sees seeded portfolio data | non-empty holdings/data on dashboard |
| 3 | Demo data isolated from real OAuth user | real user has no demo data |
| 4 | sessionStorage.isDemo flag is set | `page.evaluate(() => sessionStorage.getItem("isDemo"))` === "true" |
| 5 | Demo button shows error (disabled/404) | `page.route` mock → `getByRole("alert")` visible |
| 6 | Rate limit feedback (429) | `page.route` mock → alert contains "wait" |
| 7 | Demo banner visible on dashboard | `getByTestId("demo-banner")` visible, contains "demo session" |
| 8 | Login page hides button when disabled | may be skipped/fixme per design |

---

### E. data-testid checklist

Critical — E2E tests depend on these:
- [ ] `data-testid="demo-sign-in-button"` in `DemoButton.tsx`
- [ ] `data-testid="demo-banner"` in `AppShell.tsx`

---

### F. Coverage gaps to watch for

1. **`signCookie` helper compatibility**: The existing `signCookie(userId)` computes HMAC over `userId`. For demo tests, the raw `demo:user-123.${hmacSign("demo:user-123", SECRET)}` string must be used directly — NOT `signCookie("demo:user-123")` which would sign the prefix incorrectly.

2. **Banner on portfolio/transactions**: Design says to update these pages too (4f). If impl skips them, banner won't show on those pages.

3. **Scenario 8 (DEMO disabled)**: Design notes this is hard to test in E2E (SSR env var). Acceptable to skip or mark `.fixme`.

4. **Proxy route error handling**: The proxy must return 502 on fetch failure (catch block). Verify error response shape `{ error: "upstream_error" }`.

5. **DemoButton sessionStorage cleanup on error**: If fetch fails, `sessionStorage.removeItem("isDemo")` must be called before showing error.

---

## Test Suite Commands

```
npm run lint
npm run test:unit
npm run test:integration:full:host
npm run test:e2e:bypass:mem
npm run test:e2e:oauth:mem
```

All 5 must pass for Wave 2 exit criteria.
