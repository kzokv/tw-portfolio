---
slug: kzo-92
source: scope-grill
created: 2026-05-14
tickets: [KZO-92]
required_reading: [docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md]
superseded_by: null
---

# Todo: KZO-92 — Rebrand TW Portfolio → Vakwen

> **For agents starting a fresh session:** read the transition doc listed in `required_reading` above before starting implementation. It contains the load-bearing cutover sequence + rollback procedure that constrains how the code changes are landed.

> **Brand name caveat:** "Vakwen" is the working name. The trademark + domain availability check is open (see Open Items). If trademark conflict surfaces, swap occurrences via single sed pass — every reference to `Vakwen` / `vakwen` / `VAKWEN` is positionally trivial because the source is mechanically uniform.

## Implementation Steps

Organized by surface. Steps within a section can run in parallel. Sections can be done in order or as one large diff.

### Section 1 — User-visible display strings (4 surfaces, LOW risk)
- [x] `apps/web/app/layout.tsx`: update `metadata.title` `"TW Portfolio"` → `"Vakwen"`
- [x] `apps/web/app/layout.tsx`: update `metadata.description` to `"Multi-market portfolio intelligence"` (drop "Taiwan")
- [x] `apps/web/app/layout.tsx`: add `metadata.openGraph: { title, description, siteName: "Vakwen" }` + `metadata.twitter: { card: "summary", title, description }`
- [x] `apps/web/app/layout.tsx`: add `metadata.icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" }`
- [x] `apps/web/app/login/page.tsx:31`: update H1 `"TW Portfolio"` → `"Vakwen"`
- [x] `apps/web/app/share/[token]/page.tsx`: **leave alone** — `"Portfolio snapshot"` is the domain noun, not brand

### Section 2 — Visual placeholder assets (new files, LOW risk)
- [x] Generate `apps/web/public/favicon.ico` — monochrome "V" on solid color, 16x16 + 32x32 multi-resolution ICO
- [x] Generate `apps/web/public/icon.png` — 32x32 PNG, same design
- [x] Generate `apps/web/public/apple-touch-icon.png` — 180x180 PNG, same design (Apple's required size)
- [x] No `manifest.json` for now — PWA capability is not in scope. Add in future brand-identity ticket.

### Section 3 — README + AGENTS + evergreen docs (LOW risk, mechanical)
- [x] `README.md`: header `# Taiwan Portfolio Monorepo` → `# Vakwen` + body description rewrite (drop "Taiwan stock/ETF portfolio tracking" framing)
- [x] Root `AGENTS.md`: update `@tw-portfolio/...` workspace-name references throughout
- [x] Per-subtree `AGENTS.md` files (apps/api, apps/web, libs/*): same
- [x] `docs/001-architecture/{architecture,glossary,app-config,backend-db-api,web-frontend}.md`: replace brand-name references
- [x] `docs/002-operations/{runbook,environment-variables}.md`: same
- [x] `docs/market-data-platform.md`: same
- [x] `infra/cloudflared/README.md`: update hostname table (`twp-web` → `vakwen-web`, `twp-prod-web` → `vakwen-prod-web`)
- [x] `docs/git-pr-flow.md`: add a one-paragraph note that branch slug vocabulary uses the new brand vocabulary going forward; `KZO-` ticket prefix stays (Linear team `kzokv` is separate from product brand)

### Section 4 — `.claude/` in-repo references (LOW risk)
- [x] `.claude/CLAUDE.md`: workspace-name + repo-name references
- [x] `.claude/memory/*.md` files: workspace names, repo dir path references
- [x] `.claude/rules/*.md` files: code examples that use `@tw-portfolio/*` imports — many rules have inline import snippets
- [x] **DO NOT** edit `.claude/worktrees/*` content (those are isolated branches; this PR is itself in a worktree)
- [x] **DO NOT** edit `docs/004-notes/*` historical frozen docs except the kzo-92/ subdir we own

### Section 5 — NPM package scope `@tw-portfolio/*` → `@vakwen/*` (MEDIUM risk, mechanical)
- [x] Rename 9 `package.json` `"name"` fields:
  - [x] `libs/config/package.json`
  - [x] `libs/domain/package.json`
  - [x] `libs/shared-types/package.json`
  - [x] `libs/test-framework/package.json`
  - [x] `libs/test-framework/eslint-plugin/package.json` (`@vakwen/eslint-plugin-aaa`)
  - [x] `libs/test-e2e/package.json`
  - [x] `libs/test-api/package.json`
  - [x] `apps/api/package.json`
  - [x] `apps/web/package.json`
- [x] Update root `package.json` `"name": "tw-portfolio"` → `"vakwen"`
- [x] Update root `package.json` scripts: every `npm run build -w @tw-portfolio/...` → `@vakwen/...`
- [x] Update **~923 import statements** across `apps/**`, `libs/**`, `scripts/**`:
  - [x] Use `grep -rln "@tw-portfolio/" --include="*.ts" --include="*.tsx" apps libs scripts | xargs sed -i.bak 's|@tw-portfolio/|@vakwen/|g'`
  - [x] Then `find . -name "*.bak" -delete`
- [x] Update `apps/web/vitest.config.ts` alias entries (**preserve longest-prefix-first order** per `.claude/rules/vitest-config-patterns.md`)
- [x] Update all `tsconfig*.json` `paths` entries:
  - [x] `apps/web/tsconfig.json`
  - [x] `apps/api/tsconfig.json`
  - [x] `apps/api/test/tsconfig.json`
  - [x] root `tsconfig*.json` if any path mappings exist
- [x] Update `.github/workflows/ci.yml` `-w @tw-portfolio/*` flags (29 hits)
- [x] Regenerate `package-lock.json`: `rm -rf node_modules package-lock.json && npm install`
- [x] **Pre-merge grep-verify**: `grep -rln "@tw-portfolio" . | grep -v node_modules | grep -v docs/004-notes/0` — should return only intentional historical refs in frozen docs

### Section 6 — Env var name renames (MEDIUM risk, mechanical, hard-cut)
- [x] `TWP_STATE_DIR` → `VAKWEN_STATE_DIR` (6 sites):
  - [x] `infra/scripts/deploy.sh`
  - [x] `infra/scripts/backup-postgres.sh`
  - [x] `libs/config/src/env-docker.ts`
  - [x] `libs/config/src/env-metadata.ts`
  - [x] `.env.example` (commented stub)
  - [x] `docs/002-operations/runbook.md`
- [x] `TWP_MANAGED_CI_STACK` → `VAKWEN_MANAGED_CI_STACK` (49 sites):
  - [x] `scripts/test-integration-ci-lib.sh`
  - [x] All 30+ integration tests in `apps/api/test/integration/*.test.ts` that read `process.env.TWP_MANAGED_CI_STACK`
- [x] **Pre-merge grep-verify**: `grep -rn "TWP_" --include="*.ts" --include="*.sh" --include="*.yml" .` — should return zero hits outside historical frozen docs

### Section 7 — Docker compose containers + project + DB defaults (HIGH-risk-if-wrong, mechanical)
- [x] All `container_name: twp-{dev,local,prod}-*` → `vakwen-{dev,local,prod}-*` across:
  - [x] `infra/docker/docker-compose.dev.yml` (6 containers)
  - [x] `infra/docker/docker-compose.local.yml` (5 containers)
  - [x] `infra/docker/docker-compose.prod.yml` (6 containers)
- [x] Compose project name `name: twp-local` → `vakwen-local` in `docker-compose.local.yml`
- [x] Internal hostname references in `DB_URL` templates: `twp-{dev,local,prod}-postgres` → `vakwen-{dev,local,prod}-postgres`
- [x] Default `POSTGRES_DB:-tw_portfolio` → `POSTGRES_DB:-vakwen` across all compose files
- [x] Default `POSTGRES_USER:-twp` → `POSTGRES_USER:-vakwen` across all compose files
- [x] `pg_isready -U ${POSTGRES_USER:-twp}` → `${POSTGRES_USER:-vakwen}` in compose healthcheck commands
- [x] `infra/docker/.env.local`: `POSTGRES_USER=twp` → `vakwen`, `POSTGRES_DB=tw_portfolio` → `vakwen`
- [x] `infra/docker/fixtures/env.{dev,prod,local}.ci`: update PUBLIC_DOMAIN_* + POSTGRES_* values
- [x] CI integration compose `infra/docker/docker-compose.ci-integration.yml`: only `POSTGRES_DB: tw_portfolio_ci` → `vakwen_ci` (CI uses generic `app` user already)

### Section 8 — Deploy script `infra/scripts/deploy.sh` (LOW risk, single file, 29 sites)
- [x] All `STACK_PREFIX="twp-{dev,prod}"` → `vakwen-{dev,prod}"`
- [x] All `COMPOSE_PROJECT="twp-{dev,prod}"` → `vakwen-{dev,prod}"`
- [x] All `POSTGRES_CONTAINER`, `REDIS_CONTAINER`, `API_CONTAINER`, `WEB_CONTAINER`, `CLOUDFLARED_CONTAINER`, `MIGRATE_SERVICE` assignments
- [x] `LEGACY_BACKUP_DIR="${LEGACY_BACKUP_DIR:-/data/backups/tw-portfolio}"` → `/data/backups/vakwen`
- [x] Help text + comments + `tw-portfolio` mentions in descriptions
- [x] Image cleanup comments (`twp/alpine-related Docker images`)
- [x] State dir default `~/.local/state/tw-portfolio/$ENVIRONMENT` → `~/.local/state/vakwen/$ENVIRONMENT`

### Section 9 — Public domain stubs (LOW risk, subdomain prefix only)
- [x] `.env.example` line 177–178: `PUBLIC_DOMAIN_WEB=twp-dev-web.kzokvdevs.dpdns.org` → `vakwen-dev-web.kzokvdevs.dpdns.org`; same for API
- [x] `infra/docker/fixtures/env.{dev,prod}.ci`: same subdomain replacement
- [x] `infra/cloudflared/README.md` hostname table: `twp-{web,api}` → `vakwen-{web,api}`
- [x] Host domain `.kzokvdevs.dpdns.org` **unchanged** — preserves cookie scope + active sessions
- [x] `SESSION_COOKIE_NAME=g_auth_session` **unchanged**
- [x] `COOKIE_DOMAIN=.kzokvdevs.dpdns.org` **unchanged**

### Section 10 — Verification (mandatory pre-PR)
- [x] `npm install` clean (no peer-dep warnings due to scope rename)
- [x] Lint clean: `npx eslint . --max-warnings=0`
- [x] Typecheck clean: `npm run typecheck`
- [x] Full 8-suite gate: `npm run test:all:full` per `.claude/rules/full-test-suite.md`
- [x] Local smoke: `npm run dev:local:bypass:pg` boots cleanly; visit `http://localhost:3000` and confirm `<title>Vakwen</title>` + favicon renders
- [x] Pre-PR code review per `.claude/rules/code-review-before-pr.md`: produce a structured review doc at `docs/004-notes/kzo-92/review-{datetime}-{slug}.md`
- [x] Grep-verify zero remaining old-brand references (the section-end grep checks above)

### Section 11 — PR + commit (LOW risk, follows conventions)

> **Status:** PR description, title, and recommended commit message **drafted** in `.worklog/team/pr-description-draft.md` and ready to copy into `gh pr create`. The literal `git commit` / `gh pr create` invocations are operator-side per the `/solo-dev` Git Policy ("Do NOT create commits, branches, or push — leave for user").

- [x] Commit message follows `.claude/rules/commit-format.md`: `refactor(repo): KZO-92: rebrand TW Portfolio to Vakwen` *(drafted)*
- [x] PR title: `refactor(repo): KZO-92: rebrand TW Portfolio to Vakwen` *(drafted)*
- [x] PR body follows `docs/git-pr-flow.md` template: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` *(drafted)*
- [x] PR body links the transition doc (`docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md`) as the prod-cutover playbook *(drafted)*
- [x] PR body lists the renamed-types table (per `.claude/rules/process-refactor-rename-verification.md`) *(drafted)*
- [x] PR body explicitly notes: "Sessions preserved (cookie domain unchanged). No prod data loss (ALTER DATABASE used). Manual cutover steps in linked transition doc." *(drafted)*

### Section 12 — GitHub repo rename (after PR merge)

> **Status:** Operator-side post-merge steps. Cannot be ticked by an agent. Detailed in `transition-202605141500-prod-cutover.md` §3.12.

- [ ] Operator runs `gh repo rename vakwen` from local clone (per `transition-202605141500-prod-cutover.md` §3.12)
- [ ] Verify CI green on first push to renamed repo
- [ ] Update `origin` remote URL on all dev machines + QNAP (optional; auto-redirect works)

### Section 13 — Manual prod cutover (after PR merge + GitHub rename)

> **Status:** Operator-side post-merge steps. Cannot be ticked by an agent. The full ops playbook lives in `transition-202605141500-prod-cutover.md`.

- [ ] Operator follows the full sequence in `docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md`
- [ ] Sign-off via §4 verification checklist in the transition doc

## Open Items

These have no code component and are tracked outside this PR:

- [ ] **(User task)** Run trademark clearance for "Vakwen" through legal counsel before any external/marketing exposure. Working name is fine for internal/dev use.
- [ ] **(Future Linear ticket — to be created at write-back)** Domain migration to a Vakwen-owned TLD (e.g. `vakwen.app`). Will mirror this rebrand but include cookie-domain change (invalidates sessions).
- [ ] **(Future ticket — design discipline, not file-create here)** Final brand identity: logo, color tokens, full favicon set (16/32/48/96/192/512px + maskable), OG share image. Spawns when design work is ready.

## References

- **Linear ticket:** [KZO-92](https://linear.app/kzokv/issue/KZO-92/rebrand-platform-from-twp-to-kewora)
- **Cutover transition doc:** `docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md`
- **Scope-grill session:** 2026-05-14 (no debate spawned; resolved in Phase 1 + 1.5)

## Decision provenance

Decisions locked during scope-grill on 2026-05-14:

| # | Decision | Reasoning |
|---|---|---|
| 1 | Brand: Vakwen (single word) | User picked Vibe 1 (short invented) with K+W constraint; Vakwen wins on phonetics + distinctiveness + no etymology to defend |
| 2 | Drop "Taiwan" framing | Ticket §Why says product is now multi-market; TW market support stays unchanged at code level |
| 3 | Tier C / C1 (full code+infra, subdomain rename only) | User explicitly approved scope beyond ticket default; C1 over C2 because `vakwen.app` not yet secured |
| 4 | Cookie domain unchanged | Sessions preserved across cutover; avoids `__Host-` prefix trap + cookie-name change |
| 5 | Hard cut on env var renames | Solo dev; producer + consumer ship in same PR; shim adds dead code |
| 6 | ALTER DATABASE over drop+recreate | Preserves accumulated dev/test state (admin users, audit log, catalog data) |
| 7 | Visual placeholders included in PR | Minimum-viable visual rebrand per ticket §Branding assets; final logo work deferred |
| 8 | Linear team `kzokv` and `KZO-` prefix stay | Identity artifacts, not brand artifacts; renaming would create 102 legacy URL redirects for zero value |
