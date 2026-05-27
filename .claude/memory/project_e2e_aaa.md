---
name: e2e aaa — durable conventions
description: AAA test-framework conventions for HTTP + UI specs — fixture roles, declarative spec shape, Vitest split criteria
type: project
---

## Fixture-role separation

- API session fixtures for API-only OAuth-mode HTTP suites — mint a session cookie via `/__e2e/oauth-session`. Reusing the dev_bypass reset fixture fails because `POST /__e2e/reset` is disabled outside `AUTH_MODE=dev_bypass`.
- Reset/`x-user-id` fixtures for web E2E or any dev_bypass runner.
- Keep the two roles in separate fixture files — do not share a single base.

## Vitest vs Playwright HTTP split

When deciding whether a test belongs in Vitest or Playwright HTTP AAA, the litmus test is:

> Can this assertion be proven only from real HTTP responses plus follow-up HTTP reads?

If yes → Playwright HTTP AAA. If not (needs `vi.mock()`, `vi.stubGlobal(fetch)`, persistence inspection, event-bus inspection, or DB-schema assertions) → stays in Vitest. Mixed files get split by test purpose, not force-migrated wholesale.

## Declarative spec shape

`*-aaa.http.spec.ts` and `*-aaa.spec.ts` must be declarative:

- Playwright E2E assertion placement is promoted to `.claude/rules/e2e-aaa-guardrails.md`, including the ban on direct `expect(...)` and conditional assertion branches inside `test(...)` bodies.
- HTTP status/body checks go through assistant `assert` helpers.
- HTTP body extraction goes through assistant `arrange` helpers.
- Public AAA helper methods carry `@Step()` for Playwright step reporting.
- Shared seed logic (user creation, state seeding) goes in `tests/e2e/specs/helpers/*.ts` — excluded from the `no-restricted-syntax` rule.

## Dual-pair migration pattern (for future framework switches)

1. Add `*-aaa.*.spec.ts` alongside the legacy spec.
2. Validate one pair as a tracer bullet (both run, same scenario).
3. Run the full pair validator with normalized test titles (first path segment differs — compare the scenario title portion).
4. Only then delete the legacy spec.

Keep assistant/assert helper contracts backward-compatible until the legacy file is deleted. Tightening a helper signature mid-migration breaks the parity runner.

## Endpoint-focused reusable seams

The useful reusable seams in this repo are:

- Endpoint classes (e.g. `SharesEndpoint`, `AdminEndpoint`) — one per resource, registered in `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md`.
- Assistants (Arrange + Actions + Assert) per endpoint.
- Shared fixture composition in `apps/api/test/http/fixtures.ts`.

Avoid spec-local cookie parsing, raw request plumbing, or repeated JSON/body assertions.
