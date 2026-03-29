# Post-POC: Skill & Rule Promotion for AAA Pattern

**Status:** Scope locked
**Date:** 2026-03-28
**Context:** All AAA migration phases (5a-5e + CR cycles) are complete. This scope covers promotion of the AAA pattern to a reusable global skill, project-level curation, and documentation updates.

---

## Skill: `/aaa` (Global, User-Level)

### Location

`/Users/lume/repos/agent-dock/.codex/skills/aaa/` (symlinked to `~/.claude/skills/aaa/`)

### Directory Structure

```
~/.claude/skills/aaa/
├── skill.md                          # Main prompt, 4 subcommands
├── references/
│   └── aaa-architecture.md           # Distilled architecture (10 topics)
└── templates/
    ├── base-page.ts.tmpl
    ├── base-endpoint.ts.tmpl
    ├── assistant-triplet.ts.tmpl
    ├── fixture-chain.ts.tmpl
    ├── playwright-config.ts.tmpl
    ├── aaa-testing.md.tmpl           # 8 universal rules
    └── eslint-plugin-aaa/            # Custom ESLint plugin scaffold
```

### Subcommands

| Subcommand | Purpose | Workflow |
|---|---|---|
| `/aaa:init` | Bootstrap AAA framework in a new project | Discover codebase → interview user (architectural proposals with debate) → lock scope → scaffold 3 layers + rules + ESLint plugin |
| `/aaa:add` | Add new triplet to existing framework | Detect page/endpoint → read source → generate POM/endpoint + Arrange/Actions/Assert + register fixture. Redirects to init if framework not found. |
| `/aaa:audit` | Check AAA compliance | Scan test files → check rules + ESLint + semantic analysis (e.g., `expect` in Arrange classes). Reports violations. |
| `/aaa:migrate` | Migrate legacy tests to AAA | Full orchestration: classify tests (Category A/B/C) → dual-pair migration per file → automated parity validation → cleanup legacy. Detects "no legacy tests remain" and reports completion. |

### Hard Boundaries

- **Playwright-based monorepos only** — Playwright is a prerequisite, monorepo is assumed
- **Thin endpoint pattern** — `BaseEndpoint` returns raw `APIResponse`, not pre-parsed typed bodies
- **Per-test sessions** — no shared auth setup projects; each test mints its own session
- **2-worker parallel-by-file** — no same-file `fullyParallel`
- **No AAA for trivial unit tests** — 2-6 line pure function tests stay flat vitest style

### Interview Phase Design

The init interview includes architectural proposals with verdicts. The skill presents recommendations with rationale; user can:
- Accept the recommendation
- Override with their own choice
- Trigger a structured debate (via `/debate` or inline)

**Always-ask questions** (not auto-detected):
- displayName format
- Auth patterns (which of the 4 auth modes apply)
- Test classification criteria
- Per-test session strategy
- Parallel execution configuration

**Auto-detected** (from codebase scan):
- Test runner (must be Playwright)
- App structure (monorepo layout, workspace detection)
- Existing test files and patterns
- Framework/API stack (for POM/endpoint tailoring)

### Scaffold Output

1. **Libs:** `test-framework/` (core, mixins, decorators, config), `test-e2e/` (if web app detected), `test-api/` (if API detected)
2. **Fixture chain:** `base.ts` → app-specific extensions
3. **First triplet:** Scaffolded against a real page/endpoint discovered in the codebase (not synthetic examples)
4. **Playwright config:** `createPlaywrightConfig()` factory
5. **Package.json / tsconfig updates:** Workspace registration, path aliases
6. **Rules:** Single `aaa-testing.md` rule file (8 universal rules)
7. **ESLint plugin:** Custom plugin with AAA-specific rules

### Enforcement Surfaces

| Surface | Scope | When |
|---|---|---|
| `.claude/rules/aaa-testing.md` | Agent-enforced AAA boundaries | Always (generated at scaffold time) |
| ESLint plugin (`eslint-plugin-aaa`) | CI-enforced static analysis | On commit / PR |
| `/aaa:audit` | Semantic compliance check | On-demand (deeper than static analysis) |

### Reference Doc: `aaa-architecture.md`

Distilled from the 5900-line design doc. Covers 10 topics:

1. Three-layer architecture (test-framework → test-e2e / test-api)
2. Core classes (AAABase, WebAAABase, ApiAAABase, BasePage, BaseEndpoint, TestUser)
3. Mixin composition pattern (CoreMixin, ActionsMixin, ArrangeMixin, AssertMixin)
4. Assistant triplet pattern (Arrange/Actions/Assert + factory + fixture registration)
5. `@Step()` decorator semantics and displayName format
6. Dependency direction (framework ← app-specific, never reverse; e2e and api are siblings)
7. Locked decisions (thin endpoint, per-test sessions, 2-worker parallel-by-file, no AAA for unit tests)
8. Boundary rules (no `expect` in Arrange, no direct `page.*` in assistants, POMs are vocabulary not behavior)
9. Fixture chain pattern (base → app extensions → createWebFixture one-liner)
10. Category A/B/C classification criteria for migration

All code examples are templatized with project-specific naming, not copy-pasted from tw-portfolio.

### Universal Rules: `aaa-testing.md` (8 Rules)

1. **AAA boundary separation** — No `expect()` in Arrange, no data setup in Assert, Actions are the only place that performs the behavior under test
2. **POM vocabulary, not behavior** — BasePage/BaseEndpoint define locators/HTTP bindings only; business logic lives in assistant triplets
3. **Fixture isolation** — Each test gets its own TestUser and identity; no shared mutable state between tests
4. **Parallel guardrails** — 2 workers, parallel-by-file, no same-file `fullyParallel`; serial mode must be justified
5. **Dependency direction** — test-framework is generic and reusable; test-e2e and test-api import from framework but never from each other
6. **No AAA for trivial unit tests** — AAA pattern is for multi-step E2E/API flows; 2-6 line pure function tests stay flat vitest
7. **`get el()` typed getter is by design** — TypeScript `declare` narrowing requires per-subclass getter; not duplication
8. **TestUser is the shared orchestrator** — Lives in test-framework, manages identity, displayName, and assistant access

---

## Phase A: Curation (Session 1)

### A1: Update `project_automation_refactor.md` Memory

Update to reflect completion. Point to frozen docs and the `/aaa` skill as durable artifacts.

### A2: Update `project_workflow.md` Memory

Reflect current workflow state (automation refactor complete).

### A3: Save 5 Process-Knowledge Memories

New memory entries capturing migration arc insights:

1. **Phased migration with dual-pair validation** — The only safe test framework migration strategy. Keep old + new specs running in parallel, validate parity, then delete old.
2. **Code review as a formal phase** — Run structured CR before PR creation, not just as PR review. Phase 5d CR produced 23 items across 5 severity tiers; caught architectural drift early.
3. **Test framework work is architecture work** — Scoping as "just rewrite tests" underestimates 3-5x. Surfaced readiness contracts, hydration races, fixture isolation, parallel contention, auth mode semantics.
4. **Structured debate resolves architectural forks** — The thin vs rich endpoint debate saved an entire iteration. Worth repeating for any decision with >1 viable option and downstream lock-in.
5. **Category A/B/C classification before implementation** — Knowing upfront which tests migrate and which stay prevents mid-implementation scope surprises.

### A4: Consolidate 3 Rule Clusters

Merge within clusters, keep loosely-related rules as separate files.

**Cluster 1 → `playwright-navigation-patterns.md`:**
- `playwright-cross-port-navigation.md`
- `playwright-sse-networkidle.md`
- `playwright-webserver-startup.md`

**Cluster 2 → `playwright-oauth-cookie-patterns.md`:**
- `playwright-oauth-cookie-domain.md`
- `session-cookie-host-prefix.md`
- ~~`playwright-duplicate-testid-pattern.md`~~ (stays separate — tangential)

**Cluster 3 → `vitest-config-patterns.md`:**
- `vitest-auth-mode-override.md`
- `vitest-module-state-isolation.md`
- `vitest-alias-precedence.md`

### A5: Move 2 CLAUDE.md Testing Entries to `.claude/rules/`

| CLAUDE.md entry | Destination |
|---|---|
| "E2E AAA Guardrails" | `.claude/rules/e2e-aaa-guardrails.md` (own file, separate from universal `aaa-testing.md`) |
| "Test File Placement" | `.claude/rules/test-file-placement.md` |

### A6: Slim CLAUDE.md

Remove the two testing entries after A5. No other changes.

### A7: Check and Update AGENTS.md

Verify AGENTS.md reflects:
- 3 new libs (`test-framework`, `test-e2e`, `test-api`)
- API HTTP test commands (Playwright)
- Workspace registrations
- 7-suite "full tests pass" definition

Update if missing.

---

## Phase B: Skill Creation (Session 2)

### B1: Create Skill Directory Structure

```
~/.claude/skills/aaa/
├── skill.md
├── references/
│   └── aaa-architecture.md
└── templates/
    └── (all template files)
```

### B2: Write `references/aaa-architecture.md`

Distill the 10 topics from the frozen design docs into a single reference document. Templatized, not tw-portfolio-specific.

### B3: Write Templates

Templatized scaffold files for:
- BasePage, BaseEndpoint
- Assistant triplet (Arrange/Actions/Assert + factory)
- Fixture chain (base → extensions → createWebFixture)
- Playwright config factory
- Universal rules (`aaa-testing.md`)
- ESLint plugin scaffold

### B4: Write `skill.md`

Main skill prompt with 4 subcommand sections (init, add, audit, migrate). Includes:
- Discovery phase logic
- Interview protocol with debate integration
- Scaffold orchestration
- Audit checklist
- Migration orchestration with Category A/B/C classification
- Dual-pair validation automation

### B5: Write Universal Rules Template

The 8 rules as a `.md.tmpl` file that gets placed in the target project's `.claude/rules/aaa-testing.md`.

### B6: Write ESLint Plugin Scaffold Template

Custom ESLint plugin with AAA-specific rules:
- `no-expect-in-arrange` — forbid `expect()` in classes extending BaseArrange
- `no-direct-page-access` — forbid `this.page.*` in assistant classes
- Additional rules as identified during template authoring

---

## Phase C: Validation (Session 3)

### C1: Invoke `/aaa:audit` Against tw-portfolio

Run the audit subcommand against the existing tw-portfolio codebase. Expected result: framework detected, compliance report generated, any remaining violations surfaced.

### C2: Dry-Run `/aaa:init` Mental Model

Walk through the init flow against a hypothetical second Playwright monorepo project. Verify the interview questions, scaffold output, and rule generation make sense for a non-tw-portfolio codebase.

---

## Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Playwright-based monorepos only | Battle-tested boundary; framework deeply coupled to Playwright fixtures and APIRequestContext |
| D2 | Subcommands over separate skills | Matches `/si:*` pattern; shared context; single namespace |
| D3 | Thin endpoint (raw APIResponse) | 47% of tests assert on non-2xx; typed returns lie for error paths; header/cookie access needed |
| D4 | Templates separate from reference doc | Clean separation of concerns; templates are code, reference is prose |
| D5 | 8 universal rules in single file | Includes `get el()` and TestUser as structural consequences of AAA architecture |
| D6 | ESLint plugin + audit (two-layer enforcement) | Static analysis catches syntax violations; audit catches semantic violations |
| D7 | Skill reference inside skill directory | Self-contained; no codex prompt duplication |
| D8 | Project pitfalls stay project-scoped | Universal skill doesn't carry project-specific incident knowledge |
| D9 | Interview includes debate option | Architectural forks need structured resolution, not guessing |
| D10 | `/aaa:migrate` does full orchestration | Classification through cleanup; skill owns the migration lifecycle |
| D11 | Memory: update + replace + 5 new | Completion pointer, process knowledge preservation |
| D12 | Rule consolidation: merge within clusters | 3 clusters consolidated; loosely-related rules stay separate |
| D13 | CLAUDE.md slimmed: 2 entries moved to rules | AAA guardrails and test placement are behavioral rules, not project context |
