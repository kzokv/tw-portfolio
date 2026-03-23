# Debate: Q8 — e2eEnvSchema Scope: Replace TestEnv Internals or Keep Separate

> Date: 2026-03-22
> Participants: Architect, QA Engineer
> Topic: Should e2eEnvSchema replace TestEnv internals or remain a separate validation layer?

## Options Under Consideration

### Option A — Replace TestEnv internals with e2eEnvSchema

TestEnv reads from `e2eEnvSchema.parse(process.env)` under the hood. The public API (`TestEnv.host`, `TestEnv.ports.web`, `TestEnv.oauth.clientId`, etc.) stays identical. Defaults that are currently in getter fallbacks (`?? "localhost"`, `?? 4445`) move to Zod `.default()` declarations. GOOGLE_OAUTH_REFRESH_TOKEN and the other raw `process.env` reads in `auth.setup.ts` and `playwright.oauth.config.ts` get folded into the schema.

### Option B — e2eEnvSchema is separate from TestEnv

A new `e2eEnvSchema` Zod schema is created alongside TestEnv. It validates E2E-specific env vars (MOCK_OAUTH_PORT, HOST, GOOGLE_TOKEN_URL, GOOGLE_OAUTH_REFRESH_TOKEN) at Playwright startup — e.g., parsed once in each `playwright.*.config.ts`. TestEnv stays exactly as-is: plain getters with `??` fallbacks and hardcoded oauth credentials. The two coexist.

## Current State (Facts)

- `TestEnv` (130 lines in `libs/config/src/test.ts`) exports: host, ports, oauth config, sessionCookieName, mockTokenUrl, googleRedirectUri, appBaseUrl, apiBaseUrl, webBaseUrl, apiServerEnv(), webServerEnv(), loadDotEnvSync().
- `TestEnv.host`, `TestEnv.ports.*`, `TestEnv.sessionCookieName` already read from `process.env` with `??` fallback defaults.
- `TestEnv.oauth` is fully hardcoded (no env reads): `clientId`, `clientSecret`, `sessionSecret`.
- `auth.setup.ts` reads `process.env.GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` raw with no Zod validation.
- `playwright.oauth.config.ts` reads `process.env.PERSISTENCE_BACKEND`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, `APP_BASE_URL` raw — each with `?? TestEnv.*` fallback.
- Production code uses `envSchema` (Zod) → `Env` (frozen object) pattern in `env.ts`.
- TestEnv is consumed by: `playwright.config.ts`, `playwright.oauth.config.ts`, `flows.ts`, `auth.setup.ts`, and 7 spec files.

## Debate Rounds

### Round 1

**Architect:** The codebase has a clear pattern: Zod schema defines the shape and defaults, a single parse entry point produces a validated object, and consumers read from that object. That's `envSchema` → `Env` for production, `webEnvSchema` → `WebEnv` for Edge runtime. TestEnv should follow the same pattern. If we create `e2eEnvSchema` and parse it inside TestEnv, we get fail-fast validation at import time, type safety on all env reads, and one source of truth for E2E defaults. The public API doesn't change — getters become property reads on a parsed object. And critically, we finally formalize GOOGLE_OAUTH_REFRESH_TOKEN, which is currently a raw `process.env` read with no validation in `auth.setup.ts`.

**QA Engineer:** I hear you on the pattern consistency argument, but let me push back. TestEnv is fundamentally different from `Env`. `Env` validates a runtime process that *must* have correct env vars or the server should crash. TestEnv is a *convenience helper* for test configuration — its job is to provide sensible defaults so test runs "just work" with zero configuration. The `??` fallback pattern is intentional: if HOST isn't set, you get "localhost". If MOCK_OAUTH_PORT isn't set, you get 4445. No validation error, no crash, no friction. If you put Zod validation behind TestEnv, you risk turning a frictionless `npx playwright test` into a "fix your env vars first" exercise. That's a regression in developer experience.

### Round 2

**Architect:** That's a fair point about DX, but Zod schemas with `.default()` give you *exactly* that behavior — if HOST isn't set, the schema returns "localhost" as the default. The developer sees no difference. What they *do* gain is that if someone sets `MOCK_OAUTH_PORT=not_a_number`, they get a clear Zod error instead of a silent `NaN` propagating through port bindings. The current code does `Number(process.env.MOCK_OAUTH_PORT ?? 4445)` — if someone sets `MOCK_OAUTH_PORT=foo`, they get `NaN` silently. That's a real debugging trap. And look at `playwright.oauth.config.ts` lines 77-82 — it's doing `process.env.GOOGLE_CLIENT_ID ?? TestEnv.oauth.clientId` manually for six different variables. That's exactly the kind of env-reading boilerplate that a schema + parsed object eliminates.

**QA Engineer:** You make a good case on the NaN issue, I'll grant that. But I have a structural concern. TestEnv isn't just a bag of env values — it has *computed properties* (`mockTokenUrl`, `googleRedirectUri`, `appBaseUrl`) and *builder methods* (`apiServerEnv()`, `webServerEnv()`). A Zod schema can't express those. So even with Option A, you'd still need the TestEnv object wrapping the parsed values. Now you have three layers: Zod schema → parsed values → TestEnv wrapper with computed props. Compare that to what we have today: TestEnv object with getters. Adding a Zod layer under the hood adds complexity to a module whose primary virtue is simplicity. And for what? The NaN case is real but edge-y — who sets MOCK_OAUTH_PORT to a non-number in a test config?

### Round 3

**Architect:** The complexity argument cuts both ways. Today, `playwright.oauth.config.ts` is doing its own mini env-resolution layer: six `process.env.X ?? TestEnv.Y` expressions that duplicate both the env var names and the fallback logic. That's complexity, just spread across files instead of consolidated. With e2eEnvSchema inside TestEnv, the oauth config simplifies to `TestEnv.apiServerEnv({ AUTH_MODE: "oauth" })` and the env resolution happens once, correctly. As for the three-layer concern — the "wrapper" is trivial. Production `Env` does the same thing: `envSchema.parse()` produces `_parsed`, then `Env = Object.freeze({ ..._parsed, validateEnvConstraints(), getGoogleOAuthEnvConfig(), ... })`. TestEnv would follow the identical pattern: parse → extend with computed properties. That's not three layers of complexity; it's the established architecture.

**QA Engineer:** Now *that* is the strongest argument you've made. The scattered `process.env.X ?? TestEnv.Y` in `playwright.oauth.config.ts` genuinely bothers me too — it's a maintenance trap where env var names can drift. But here's my counter-proposal and the real question: can we get those benefits with Option B instead? What if `e2eEnvSchema` is a *separate* schema that `playwright.oauth.config.ts` parses at startup to validate its env overrides, while TestEnv stays as-is for the majority of consumers that don't need env override validation? The six raw reads in the oauth config move into a local `e2eEnvSchema.parse(process.env)` call right there. TestEnv stays simple for the 80% case (dev_bypass suite, test helpers, spec files). We validate where it matters without rewriting the guts of a stable, well-tested module.

### Round 4

**Architect:** That's a clean proposal, but it creates a worse problem: two sources of truth for the same defaults. If `e2eEnvSchema` defines `HOST` with default `"localhost"` and TestEnv's getter also defaults to `"localhost"`, they *must* stay in sync — but nothing enforces that. Somebody changes the TestEnv default to `"127.0.0.1"` for the IPv6 issue and forgets to update the schema, or vice versa. With Option A, the defaults live in one place (the schema), and TestEnv reads from the parsed result. That's the whole point of single-source-of-truth. And the "stable, well-tested module" argument is a bit generous — TestEnv is 130 lines of getters with `??` fallbacks, not a load-bearing subsystem. Replacing those fallbacks with schema defaults is a mechanical refactor, not a risky rewrite.

**QA Engineer:** The two-sources-of-truth argument would be compelling if the overlap were large, but let me look at what `e2eEnvSchema` actually needs to validate per the KZO-106 ticket: MOCK_OAUTH_PORT, HOST, GOOGLE_TOKEN_URL, GOOGLE_OAUTH_REFRESH_TOKEN. Of those four, only MOCK_OAUTH_PORT and HOST overlap with TestEnv. GOOGLE_TOKEN_URL is a computed property in TestEnv (`mockTokenUrl`), not an env default. GOOGLE_OAUTH_REFRESH_TOKEN doesn't exist in TestEnv at all — it's only read in `auth.setup.ts`. So the actual overlap is two fields. Two fields that have been stable since TestEnv was created. I'm not convinced we need to rewrite TestEnv's internals to keep two defaults in sync, especially when a JSDoc comment saying "keep in sync with e2eEnvSchema" would suffice for that scale.

### Round 5

**Architect:** JSDoc comments as sync enforcement? We both know those rot. But let me concede something: you're right that the KZO-106 schema's overlap with TestEnv is small *today*. The real value of Option A isn't the four fields in the ticket — it's future-proofing the validation surface. Right now, `playwright.oauth.config.ts` does six unvalidated env reads. `auth.setup.ts` does three more. As we add more E2E scenarios, those raw reads will multiply. Option A gives us an extensible foundation where adding a new env var means adding one line to the schema, and TestEnv + all configs get it automatically. Option B means every new env var needs to be added to the schema *and* plumbed through the relevant config file manually. That said, I recognize a pragmatic middle path: **Option A, but scoped**. Don't rewrite all of TestEnv's internals — only replace the `process.env` reads (host, ports, sessionCookieName) with schema-backed values. Keep the hardcoded oauth credentials as-is (they're mock values, not env-configurable). Keep the computed properties and builder methods. This limits the blast radius while establishing the Zod-backed pattern.

**QA Engineer:** *That* I can get behind. A scoped Option A addresses my DX concern (defaults still "just work" via Zod `.default()`), my complexity concern (we're not rewriting builder methods or computed props), and your single-source-of-truth concern (env-read defaults live in the schema). The hardcoded oauth mock credentials stay hardcoded — they're test fixtures, not configuration. And `e2eEnvSchema` also adds the fields that TestEnv never had: GOOGLE_OAUTH_REFRESH_TOKEN (optional, for Path A in auth.setup.ts) and explicit GOOGLE_TOKEN_URL override. The schema lives in `test.ts` right next to TestEnv, making the relationship obvious. `playwright.oauth.config.ts` can then import the parsed values instead of doing its own `process.env.X ?? TestEnv.Y` dance. I'll accept that.

## Key Arguments Summary

| Argument | For Option A (Replace) | For Option B (Separate) |
|---|---|---|
| **Pattern consistency** | Matches `envSchema` → `Env` production pattern | N/A — TestEnv predates the pattern |
| **Single source of truth** | Env defaults live in one place (schema) | Two defaults to sync, but overlap is only 2 fields |
| **Fail-fast validation** | Zod catches NaN ports, invalid types at import time | Validation only at Playwright startup, not in helpers |
| **Developer experience** | `.default()` preserves zero-config behavior | Current `??` fallbacks are simpler to read |
| **Complexity** | Adds Zod parse layer under TestEnv | No changes to stable TestEnv module |
| **Scattered env reads** | Eliminates 6+ raw `process.env` reads in oauth config | Raw reads remain, validated by separate schema |
| **Computed properties** | Wrapper preserves computed props / builders (like `Env`) | No wrapper needed — TestEnv is already the wrapper |
| **Future extensibility** | New env var = one schema line, auto-available | New env var = schema line + manual plumbing |
| **Blast radius** | Refactors TestEnv internals (low risk, mechanical) | Zero change to TestEnv — lowest risk |

## Consensus Decision

**Option A, scoped** — `e2eEnvSchema` replaces the `process.env` reads inside TestEnv, but the refactor is bounded:

1. **Schema-backed fields**: HOST, WEB_PORT, API_PORT, MOCK_OAUTH_PORT, SESSION_COOKIE_NAME, GOOGLE_OAUTH_REFRESH_TOKEN (optional), GOOGLE_TOKEN_URL (optional). These are the env-configurable values.
2. **Unchanged**: `TestEnv.oauth` hardcoded mock credentials stay as literal values (they're test fixtures, not configuration). Computed properties (`mockTokenUrl`, `googleRedirectUri`, `appBaseUrl`, etc.) and builder methods (`apiServerEnv()`, `webServerEnv()`, `loadDotEnvSync()`) stay as-is, reading from the parsed schema values instead of raw getters.
3. **Rationale**: Zod `.default()` preserves the zero-config DX. Single source of truth eliminates the two-defaults sync problem. Fail-fast validation catches NaN ports and type errors. Pattern matches production `envSchema` → `Env`. Scoping the change avoids rewriting builder methods or computed properties.

The QA Engineer's concern about DX regression was resolved by confirming that Zod defaults produce identical behavior to `??` fallbacks. The Architect conceded that a full TestEnv rewrite wasn't necessary — only the env-reading layer needs to change.

## Action Items

1. **Create `e2eEnvSchema`** in `libs/config/src/test.ts` with Zod definitions for: HOST (default "localhost"), WEB_PORT (coerce number, default 3333), API_PORT (coerce number, default 4000), MOCK_OAUTH_PORT (coerce number, default 4445), SESSION_COOKIE_NAME (default "__Host-g_auth_session"), GOOGLE_OAUTH_REFRESH_TOKEN (string, optional), GOOGLE_TOKEN_URL (string, optional).
2. **Parse once at module level**: `const _e2eParsed = e2eEnvSchema.parse(process.env)` — same pattern as `env.ts` line 12.
3. **Refactor TestEnv getters** to read from `_e2eParsed` instead of `process.env` with `??` fallbacks. Keep computed properties, builder methods, and hardcoded oauth values unchanged.
4. **Export `e2eEnvSchema`** for consumers that need raw schema access (e.g., `playwright.oauth.config.ts` for additional env validation beyond TestEnv's scope).
5. **Refactor `playwright.oauth.config.ts`** to eliminate the six manual `process.env.X ?? TestEnv.Y` expressions — use TestEnv (now schema-backed) or import `_e2eParsed` directly.
6. **Refactor `auth.setup.ts`** to read GOOGLE_OAUTH_REFRESH_TOKEN from TestEnv (now schema-backed) instead of raw `process.env.GOOGLE_OAUTH_REFRESH_TOKEN`.
7. **Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET** to `e2eEnvSchema` as optional fields (for Path A in auth.setup.ts). TestEnv.oauth hardcoded values serve as the fallback when env vars aren't set — express this as `schema default = TestEnv.oauth.clientId` or resolve in the TestEnv object layer.
