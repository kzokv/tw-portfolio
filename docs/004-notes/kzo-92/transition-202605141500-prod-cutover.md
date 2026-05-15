# KZO-92 — Vakwen Prod Cutover Walk-through

**Date:** 2026-05-14
**Owner:** keith (solo dev)
**Scope:** Step-by-step manual operator playbook for cutting prod from `TW Portfolio` to `Vakwen` (Tier C / C1 — subdomain rename only).
**Status:** Frozen-snapshot per `doc-management.md`. Pre-merge corrections OK; immutable after PR lands.

---

## 0. Context

KZO-92 renames the product from **"TW Portfolio"** to **"Vakwen"** across code + infra. Code-side changes ship in the rebrand PR. This doc covers everything the operator does **outside** the PR — Google Cloud Console, Cloudflare Zero Trust, QNAP filesystem, and the prod `.env.prod`.

### What's changing operationally

| Surface | Before | After |
|---|---|---|
| GitHub repo | `kzokv/tw-portfolio` | `kzokv/vakwen` |
| Prod web hostname | `twp-web.kzokvdevs.dpdns.org` | `vakwen-web.kzokvdevs.dpdns.org` |
| Prod API hostname | `twp-api.kzokvdevs.dpdns.org` | `vakwen-api.kzokvdevs.dpdns.org` |
| Cookie domain | `.kzokvdevs.dpdns.org` | **unchanged** |
| Session cookie name | `g_auth_session` | **unchanged** |
| OAuth client | one Google client | **same client**, new redirect URIs added |
| Postgres DB name | `tw_portfolio` | `vakwen` |
| Postgres user | `twp` | `vakwen` |
| Container project | `twp-prod` | `vakwen-prod` |
| Container names | `twp-prod-*` | `vakwen-prod-*` |
| State dir (QNAP) | `~/.local/state/tw-portfolio/prod/` | `~/.local/state/vakwen/prod/` |
| Backup dir (QNAP) | `/data/backups/tw-portfolio/` | `/data/backups/vakwen/` |

### What stays unchanged

- The host domain `kzokvdevs.dpdns.org` — only the `twp-*` subdomain prefix becomes `vakwen-*`. Cookie scope unchanged, sessions preserved.
- The Google OAuth **client ID + secret** — only the *redirect URI list* gets new entries.
- The Cloudflare Zero Trust **tunnel** itself — only its *ingress routes* gain new entries.
- The Postgres **named volume** `pgdata` — but compose project rename creates a new volume namespace. Volume migration is required (see §3.5).
- The session secret (`SESSION_SECRET`), CORS config (`ALLOWED_ORIGINS` value changes to new domain), and all encryption keys.

### Real-user impact

**None.** Prod has no real users as of KZO-92 scope-lock — only Keith's own test accounts. A ~30 min cutover window with brief downtime is acceptable. No user notification required.

---

## 1. Prerequisites

Run through this checklist **before scheduling the cutover window**.

### 1.1 Code-side

- [ ] KZO-92 PR merged to `dev` and green on CI (all 8 suites + pr-gate)
- [ ] Local verification passed (`npm run dev:local:bypass:pg` boots cleanly with new `vakwen-local-*` container names)
- [ ] Lock-file diff reviewed (`package-lock.json` will be ~1MB of churn from `@tw-portfolio/*` → `@vakwen/*` — this is expected)

### 1.2 Brand verification (user task)

- [ ] **Trademark check for "Vakwen"** in target markets (USPTO TESS, EUIPO eSearch, IPONZ, IP Australia)
- [ ] **Domain availability check**:
  - `vakwen.com` — primary
  - `vakwen.app` — fallback (forces HTTPS, modern tech vibe)
  - `vakwen.io` — only if you want dev-tools connotation
  - You don't need to **purchase** anything for KZO-92 (we stay on `kzokvdevs.dpdns.org`), but you'll want one secured before the eventual top-level-domain migration.
- [ ] **Search-engine sniff**: `"Vakwen" finance`, `"Vakwen" portfolio`, `"Vakwen" startup`, `"Vakwen" app`, `"Vakwen" review` — first page should be clean
- [ ] **AppStore / Play Store search** for "Vakwen" — should return zero hits

If any of these fail, pause the cutover and revisit naming (the working name `Vakwen` was chosen with variants `Vakwena`, `Vakwora`, `Vakwell`, `Vakwe` in reserve).

### 1.3 Access verification (operator task)

- [ ] Google Cloud Console access: project owner role on the `tw-portfolio` GCP project (or whatever name; the project itself doesn't need renaming)
- [ ] Cloudflare Zero Trust dashboard access: edit rights on the existing tunnel
- [ ] QNAP SSH access (the deploy host)
- [ ] Linear admin rights (for the ticket title update + comment write-back)

### 1.4 Backups present

- [ ] Recent backup exists in `/data/backups/tw-portfolio/` on QNAP (≤ 24h old). If not, run `bash infra/scripts/backup-postgres.sh prod` first.

---

## 2. Pre-cutover (~24h before)

Goal: stage the new endpoints **alongside** the existing ones so cutover is a config swap, not a build.

### 2.1 Add new redirect URIs to Google OAuth client

Console: `https://console.cloud.google.com/apis/credentials` → select the OAuth 2.0 client used by tw-portfolio prod.

**Add (do NOT remove the old ones yet):**

```
https://vakwen-api.kzokvdevs.dpdns.org/auth/google/callback
https://vakwen-dev-api.kzokvdevs.dpdns.org/auth/google/callback   ← if you also use dev OAuth flow
```

**Keep the existing for grace period:**

```
https://twp-api.kzokvdevs.dpdns.org/auth/google/callback
https://twp-dev-api.kzokvdevs.dpdns.org/auth/google/callback
```

Save. Google's change propagates within ~minutes.

**Verify**: Browse to `https://accounts.google.com/.well-known/openid-configuration` → not needed; trust the Console save. The next OAuth login will use whichever redirect URI the API requests, and both are now registered.

### 2.2 Add new Cloudflare tunnel routes

Console: Cloudflare Zero Trust → **Networks → Tunnels → [your tunnel] → Public Hostnames**.

**Add (alongside existing):**

| Subdomain | Domain | Service |
|---|---|---|
| `vakwen-web` | `kzokvdevs.dpdns.org` | `http://vakwen-prod-web:3000` |
| `vakwen-api` | `kzokvdevs.dpdns.org` | `http://vakwen-prod-api:4000` |

**Keep these for grace:**

| Subdomain | Domain | Service |
|---|---|---|
| `twp-web` | `kzokvdevs.dpdns.org` | `http://twp-prod-web:3000` |
| `twp-api` | `kzokvdevs.dpdns.org` | `http://twp-prod-api:4000` |

The new routes point to container names that **don't exist yet** — this is fine; Cloudflare's tunnel will report them as unhealthy until the new containers are up. Health is only checked on the first request.

### 2.3 Verify DNS resolves

From any machine outside your network:

```bash
dig vakwen-web.kzokvdevs.dpdns.org +short
dig vakwen-api.kzokvdevs.dpdns.org +short
```

Both should return Cloudflare-fronted CNAMEs (typically `<tunnel-id>.cfargotunnel.com`). If they don't resolve, the Cloudflare tunnel route wasn't saved correctly — re-do §2.2.

### 2.4 Prepare new `.env.prod` (do NOT deploy yet)

On QNAP, draft the new `.env.prod` in a `.env.prod.new` file:

```diff
- PUBLIC_DOMAIN_WEB=twp-web.kzokvdevs.dpdns.org
+ PUBLIC_DOMAIN_WEB=vakwen-web.kzokvdevs.dpdns.org

- PUBLIC_DOMAIN_API=twp-api.kzokvdevs.dpdns.org
+ PUBLIC_DOMAIN_API=vakwen-api.kzokvdevs.dpdns.org

- APP_BASE_URL=https://twp-web.kzokvdevs.dpdns.org
+ APP_BASE_URL=https://vakwen-web.kzokvdevs.dpdns.org

- ALLOWED_ORIGINS=https://twp-web.kzokvdevs.dpdns.org
+ ALLOWED_ORIGINS=https://vakwen-web.kzokvdevs.dpdns.org

- GOOGLE_REDIRECT_URI=https://twp-api.kzokvdevs.dpdns.org/auth/google/callback
+ GOOGLE_REDIRECT_URI=https://vakwen-api.kzokvdevs.dpdns.org/auth/google/callback

- POSTGRES_DB=tw_portfolio
+ POSTGRES_DB=vakwen

- POSTGRES_USER=twp
+ POSTGRES_USER=vakwen

  # DB_URL is composed from the above — confirm it ends up:
  # postgres://vakwen:<password>@vakwen-prod-postgres:5432/vakwen

- COOKIE_DOMAIN=.kzokvdevs.dpdns.org   # unchanged
  COOKIE_DOMAIN=.kzokvdevs.dpdns.org

- SESSION_SECRET=<unchanged>            # unchanged — preserves all sessions
  SESSION_SECRET=<unchanged>
```

Diff this against the running `.env.prod` and verify only these keys change.

### 2.5 Pre-cutover smoke (optional but recommended)

If you have a non-prod dev cluster on QNAP (the `twp-dev-*` stack), do a dry-run there first by walking through §3 against `dev` instead of `prod`. If dev cutover succeeds, prod cutover follows identically.

---

## 3. Cutover sequence

**Total estimated time:** 20–40 minutes including the volume migration.

**Pre-flight check:** confirm you can reach the QNAP via SSH, no other dev work is running, and you have a terminal multiplexer (tmux/screen) so a network drop doesn't abort mid-cutover.

### 3.1 Final pre-cutover backup

On QNAP, in the deploy host shell:

```bash
cd ~/.local/state/tw-portfolio/prod
bash <path-to-repo>/infra/scripts/backup-postgres.sh prod
ls -lah /data/backups/tw-portfolio/ | tail -3
```

Confirm a fresh `*.sql.gz` exists with timestamp within the last 5 minutes.

> **Ordering caveat (read before executing):** the cutover stops the OLD
> stack first via raw `docker` commands keyed on the OLD container names
> (`twp-prod-*`), takes a `pg_dump` from the live OLD Postgres, and only then
> pulls the rebranded code. The new compose file no longer declares the
> `twp-prod-*` services or `api`/`web`/`postgres` service names — once you
> pull, the only way to talk to the old containers is by their concrete
> container names (raw `docker stop / rm`), not via `docker compose`.

### 3.2 Drain prod connections (raw `docker stop` — keep Postgres up)

The new compose file no longer declares the `twp-prod-*` service names that
were originally used to start these containers, so we stop them by their
running container name rather than via `docker compose`. Postgres and Redis
stay up — we need Postgres alive for the `pg_dump` in §3.3.

```bash
docker stop twp-prod-cloudflared twp-prod-web twp-prod-api
```

This drains the app layer (no more HTTP traffic to the API or web) while
leaving `twp-prod-postgres` and `twp-prod-redis` running.

### 3.3 Dump the OLD database (single DB, ownership-stripped)

Use `pg_dump` on the specific database — **not** `pg_dumpall`. `pg_dumpall`
emits `CREATE DATABASE tw_portfolio` and `CREATE USER twp` statements that
would land sideways in the renamed cluster (where the database is `vakwen`
and the superuser is `vakwen`). `pg_dump --no-owner --no-privileges` emits
just schema + data with no `OWNER TO twp` / `GRANT … TO twp` lines that
would fail to apply after the user rename.

```bash
mkdir -p /data/backups/tw-portfolio
docker exec twp-prod-postgres \
  pg_dump -U twp -d tw_portfolio \
  --no-owner --no-privileges \
  --format=plain \
  > /data/backups/tw-portfolio/pre-rebrand-dump.sql

# Sanity-check
ls -lah /data/backups/tw-portfolio/pre-rebrand-dump.sql
head -5 /data/backups/tw-portfolio/pre-rebrand-dump.sql
# Expect a SQL dump header. Size depends on dataset (typically a few MB).
```

### 3.4 Pull rebranded code

Now safe to swap the working tree — the dump is on disk, the app is
drained, and the OLD Postgres container is still running independent of any
git state.

```bash
cd <path-to-repo>
git fetch origin
git checkout dev
git pull --ff-only
```

After the repo rename (§3.10), `origin` resolves to `kzokv/vakwen` via
GitHub's auto-redirect; you can update the remote URL explicitly later.

### 3.5 Stop and remove the remaining OLD containers + swap env file

```bash
# Stop the remaining OLD containers (Postgres + Redis) by container name.
docker stop twp-prod-postgres twp-prod-redis

# Remove all OLD containers so their names free up + they don't try to
# auto-restart. The named volume `twp-prod_pgdata` is NOT touched here —
# it's our last-line rollback artifact and gets removed in §6.3 after
# verification.
docker rm twp-prod-postgres twp-prod-redis \
          twp-prod-api twp-prod-web twp-prod-cloudflared

# Swap to the new prod env file (prepared in §2.4).
mv infra/docker/.env.prod infra/docker/.env.prod.pre-rebrand
mv infra/docker/.env.prod.new infra/docker/.env.prod
```

### 3.6 Volume namespace note — and bring up the new Postgres

Compose names volumes as `<project>_<volume>`, so:

| Before | After |
|---|---|
| `twp-prod_pgdata` | `vakwen-prod_pgdata` |

These are two distinct Docker volumes. We deliberately let the new project
create a fresh `vakwen-prod_pgdata` and restore the `pg_dump` into it; the
old volume is retained as a rollback artifact until §6.3.

The Postgres image initialises a NEW volume with `POSTGRES_USER=vakwen` and
`POSTGRES_DB=vakwen` as the superuser and default database respectively
(read from the new `.env.prod`). No legacy `postgres` superuser exists.

Bring up the new Postgres service alone — note the service name is the full
prefixed form `vakwen-prod-postgres`, not bare `postgres`, since the
compose file uses prefixed service names (and matching `container_name:`):

```bash
docker compose --project-name vakwen-prod \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.prod \
  up vakwen-prod-postgres -d

# Wait for it to become ready. The vakwen role IS the superuser.
until docker exec vakwen-prod-postgres pg_isready -U vakwen -q; do
  sleep 2
done
echo "vakwen-prod-postgres is ready."

# Confirm the `vakwen` database exists and is empty.
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c '\dt'
# Expect: "Did not find any relations."
```

### 3.7 Restore the dump into the new database

The dump is plain SQL with no `CREATE DATABASE` / `\connect` / ownership
lines, so it loads directly into the pre-created `vakwen` database as the
`vakwen` superuser. There is no `postgres` role on the new instance, and
none is needed.

```bash
cat /data/backups/tw-portfolio/pre-rebrand-dump.sql \
  | docker exec -i vakwen-prod-postgres \
      psql -U vakwen -d vakwen -v ON_ERROR_STOP=1
```

`ON_ERROR_STOP=1` aborts on the first SQL error so a partial restore can't
silently slip past. If it aborts, see §5 for rollback.

Verify row counts roughly match the OLD instance (pre-dump):

```bash
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c "\dt" | head -30
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c \
  "SELECT COUNT(*) FROM users;"
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c \
  "SELECT COUNT(*) FROM audit_log;" 2>/dev/null || true
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c \
  "SELECT COUNT(*) FROM trade_events;" 2>/dev/null || true
```

If you snapshotted these counts from the OLD instance before §3.3 (e.g.
`docker exec twp-prod-postgres psql -U twp -d tw_portfolio -c "SELECT COUNT(*) FROM users;"`),
compare now.

### 3.8 Start the full new stack

```bash
docker compose --project-name vakwen-prod \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.prod \
  up -d
```

This brings up `vakwen-prod-{redis,migrate,api,web,cloudflared}` alongside
the already-running `vakwen-prod-postgres`. The migrate service will run any
pending schema migrations against the freshly-restored `vakwen` database
(none expected; it should exit `0` quickly).

Wait for health:

```bash
docker compose --project-name vakwen-prod \
  -f infra/docker/docker-compose.prod.yml ps

# Wait until all services show "Up (healthy)" (or "Exited (0)" for migrate).
curl -fsSL https://vakwen-api.kzokvdevs.dpdns.org/health/live
# Expected: {"ok":true,...}
```

### 3.9 Move physical paths on QNAP

```bash
# State dir (used by deploy/backup scripts for logs + cached state)
mv ~/.local/state/tw-portfolio ~/.local/state/vakwen

# Backup dir (so post-cutover backups land in the new path)
mv /data/backups/tw-portfolio /data/backups/vakwen
```

Verify the rebranded backup script reads the new path:

```bash
grep "VAKWEN_STATE_DIR\|/data/backups/vakwen" infra/scripts/backup-postgres.sh
```

### 3.10 Smoke tests

End-to-end auth flow:

```bash
# 1. Open the new web URL in a fresh incognito window
open https://vakwen-web.kzokvdevs.dpdns.org
# Expected: redirected to /login (no existing session)

# 2. Click "Sign in with Google"
# Google → redirects to https://vakwen-api.kzokvdevs.dpdns.org/auth/google/callback
# → API mints session cookie on .kzokvdevs.dpdns.org
# → Web redirected to /dashboard

# 3. Verify session preserved across subdomain
# If you previously had an active session on twp-*.kzokvdevs.dpdns.org,
# that session cookie is still valid on vakwen-*.kzokvdevs.dpdns.org because
# COOKIE_DOMAIN stayed .kzokvdevs.dpdns.org. Browser DevTools → Application
# → Cookies → confirm cookie name g_auth_session is sent on the new domain.
```

Check audit log:

```bash
docker exec vakwen-prod-postgres psql -U vakwen -d vakwen -c \
  "SELECT action, COUNT(*) FROM audit_log WHERE created_at > NOW() - INTERVAL '5 minutes' GROUP BY action;"
# Expected: new audit_log entries from your test login
```

### 3.11 Mark the cutover complete (release the deploy preflight)

**Why this step is mandatory.** `infra/scripts/deploy.sh` ships with a
rebrand cutover preflight (`cutover_preflight()`) that aborts any deploy as
long as:

- the legacy Postgres volume `twp-prod_pgdata` (or `twp-dev_pgdata` for the
  dev stack) still exists on the host, AND
- the cutover sentinel file is missing.

Without this guard, the GitHub Actions deploy workflow on `main` would
auto-run the deploy script after the rebrand merge, bring up the new
`vakwen-prod` stack against an EMPTY `vakwen-prod_pgdata` volume, and pass
health checks while serving an empty database. The preflight blocks that.

Once §3.7 restore is verified and §3.8 + §3.10 smoke tests pass, mark the
cutover complete by touching the sentinel file:

```bash
# On the QNAP, as the deploy user.
SENTINEL_DIR="${VAKWEN_STATE_DIR:-$HOME/.local/state/vakwen/production}"
mkdir -p "$SENTINEL_DIR"
touch "$SENTINEL_DIR/.cutover-complete"
ls -lah "$SENTINEL_DIR/.cutover-complete"

# Same for the dev stack if you ran the same cutover there:
DEV_SENTINEL_DIR="${VAKWEN_STATE_DIR:-$HOME/.local/state/vakwen/dev}"
mkdir -p "$DEV_SENTINEL_DIR"
touch "$DEV_SENTINEL_DIR/.cutover-complete"
```

Without this file, the next automated deploy (CI or manual) aborts with a
`cutover_preflight failed` message. Re-running this `touch` is idempotent.

**Emergency bypass** (only for genuinely unrelated emergency deploys —
e.g. a security hotfix that must ship before the cutover can be finished):

```bash
ALLOW_REBRAND_CUTOVER_BYPASS=1 bash infra/scripts/deploy.sh ...
```

The bypass logs prominently and is not silent — every deploy that uses it
appears in the deploy log with `ALLOW_REBRAND_CUTOVER_BYPASS=1 set`.

### 3.12 Rename the GitHub repo

From your local shell (laptop):

```bash
cd /Users/lume/repos/tw-portfolio   # or wherever your local clone lives
gh repo rename vakwen
# Confirms: Repository kzokv/tw-portfolio renamed to kzokv/vakwen
```

GitHub will:
- Auto-redirect HTTPS + SSH clones from `kzokv/tw-portfolio` to `kzokv/vakwen` for **≥1 year**
- Preserve all webhooks, secrets, branch protection rules, GitHub Actions config, deploy keys
- Re-issue GitHub Pages if you have any (we don't)

Update your local remote (optional but cleaner):

```bash
git remote set-url origin git@github.com:kzokv/vakwen.git
git remote -v   # Verify
```

Other clones (QNAP, dev machines):

```bash
git remote set-url origin git@github.com:kzokv/vakwen.git
```

Verify CI still passes by pushing a no-op commit or re-running the latest CI workflow.

---

## 4. Verification checklist (sign-off)

- [ ] `curl https://vakwen-api.kzokvdevs.dpdns.org/health/live` returns `{"ok":true}`
- [ ] `curl https://vakwen-api.kzokvdevs.dpdns.org/health/ready` returns `{"ok":true}`
- [ ] `https://vakwen-web.kzokvdevs.dpdns.org` loads the login page with `<title>Vakwen</title>`
- [ ] Google OAuth flow completes end-to-end on new subdomain
- [ ] Browser DevTools → Application → Cookies → `g_auth_session` cookie scoped to `.kzokvdevs.dpdns.org` (not specific subdomain)
- [ ] Audit log shows new login event
- [ ] `docker ps` shows 6 containers prefixed `vakwen-prod-`
- [ ] No `twp-prod-*` containers running (`docker ps -a | grep twp-prod` should be empty or show only Exited)
- [ ] Postgres data preserved: `SELECT COUNT(*) FROM users;` matches pre-cutover count
- [ ] `docker volume ls | grep pgdata` shows the new `vakwen-prod_pgdata` volume
- [ ] **Cutover sentinel touched**: `~/.local/state/vakwen/production/.cutover-complete` exists (and the dev equivalent if dev was migrated). Without this file the next `deploy.sh` run aborts with `cutover_preflight failed`.
- [ ] **Old volume not yet removed**: `docker volume inspect twp-prod_pgdata` still succeeds (kept for §6.3 cleanup-with-grace — premature removal forfeits rollback)
- [ ] GitHub: `https://github.com/kzokv/vakwen` resolves; `https://github.com/kzokv/tw-portfolio` redirects to it
- [ ] CI green on `main` after one commit to the renamed repo

---

## 5. Rollback procedure

If cutover smoke fails (auth broken, DB connectivity broken, container crashes):

The cutover is rollback-friendly **because we never destroyed the
`twp-prod_pgdata` volume**. As long as that volume exists, every step is
reversible. The two sub-flows below cover (a) cutover failed before §3.7
restore — easiest case, just back out — and (b) the new stack came up but
data is wrong/missing.

### 5.1 Quick rollback (10–15 minutes)

Restore the OLD git state, swap env file back, and bring up the OLD project
against its preserved volume.

```bash
# 1. Stop new stack (whatever was up so far)
docker compose --project-name vakwen-prod \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.prod \
  down
# Optionally also drop the new (failed) volume to keep disk tidy:
#   docker volume rm vakwen-prod_pgdata

# 2. Restore env file
mv infra/docker/.env.prod infra/docker/.env.prod.new   # save the failed attempt
mv infra/docker/.env.prod.pre-rebrand infra/docker/.env.prod

# 3. Restore the OLD compose file via git
#    The new compose file no longer declares twp-prod-* services; we need
#    the pre-rebrand revision to bring the old stack back up cleanly.
PREV_REBRAND_COMMIT=$(git log --pretty=format:'%H' --grep='KZO-92' -1)~1   # commit before the rebrand
git restore --source="$PREV_REBRAND_COMMIT" --staged --worktree \
  infra/docker/docker-compose.prod.yml \
  infra/scripts/deploy.sh \
  apps/api/Dockerfile apps/web/Dockerfile

# 4. Bring up the OLD stack — twp-prod_pgdata volume still intact,
#    contents identical to pre-cutover.
docker compose --project-name twp-prod \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.prod \
  up -d

# 5. Verify
curl -fsSL https://twp-api.kzokvdevs.dpdns.org/health/live
```

The OLD `twp-*` Cloudflare routes are still active (we kept them in §2.2
deliberately for this), and the OLD Google OAuth redirect URIs are still
registered. **Sessions survive both directions** because the cookie domain
never changed.

### 5.2 Deep rollback — restore from the `pg_dump` (if data went wrong)

If the new stack came up but the restore (§3.7) corrupted or missed data,
the canonical source of truth is the `pg_dump` file produced in §3.3:
`/data/backups/tw-portfolio/pre-rebrand-dump.sql`.

You have two choices.

**Choice A — Re-restore the dump into the new (`vakwen`) stack.** Drop the
new database, recreate it empty, replay the dump:

```bash
# Drop and recreate the vakwen DB to land a clean restore.
docker exec vakwen-prod-postgres psql -U vakwen -d postgres -c \
  "DROP DATABASE IF EXISTS vakwen;"
docker exec vakwen-prod-postgres psql -U vakwen -d postgres -c \
  "CREATE DATABASE vakwen OWNER vakwen;"

# Re-restore.
cat /data/backups/tw-portfolio/pre-rebrand-dump.sql \
  | docker exec -i vakwen-prod-postgres \
      psql -U vakwen -d vakwen -v ON_ERROR_STOP=1
```

Note: the new instance's superuser IS `vakwen` (set by `POSTGRES_USER` on
the new compose). There is no `postgres` role — do not try `psql -U postgres`.

**Choice B — Abandon the rebrand and go back to OLD stack.** Follow §5.1.
The OLD `twp-prod_pgdata` volume still has the pre-cutover database state;
no dump replay needed.

### 5.3 GitHub repo rollback

```bash
gh repo rename tw-portfolio  # back to the old name
# GitHub re-establishes the old URL; redirects re-point.
```

This is messy but supported. Avoid if possible — only do it if you abandon
the rebrand entirely.

---

## 6. Post-cutover cleanup (~24–72h later, once stable)

Once you've used the new subdomain in normal workflows for at least a day and there's no surprises:

### 6.1 Deregister old Google OAuth redirect URIs

Console: Same OAuth client → remove:

```
https://twp-api.kzokvdevs.dpdns.org/auth/google/callback
https://twp-dev-api.kzokvdevs.dpdns.org/auth/google/callback
```

After saving, the OLD subdomain can no longer complete OAuth (it'll fail with `redirect_uri_mismatch`). Verify the NEW subdomain still works.

### 6.2 Remove old Cloudflare tunnel routes

Cloudflare Zero Trust → tunnel → Public Hostnames → delete:

| Subdomain | Domain |
|---|---|
| `twp-web` | `kzokvdevs.dpdns.org` |
| `twp-api` | `kzokvdevs.dpdns.org` |

This is reversible — adding routes back later restores them in seconds.

### 6.3 Reclaim disk

> **Ordering note.** Removing `twp-prod_pgdata` makes the deploy preflight's
> legacy-volume check stop firing — i.e. the `.cutover-complete` sentinel
> becomes a no-op afterwards. Keep the sentinel file in place regardless;
> the preflight tolerates "no legacy volume AND no sentinel" (returns 0
> early) and "legacy volume AND sentinel present" (the post-cutover state).

```bash
# Old compose volume can be deleted now (data already migrated, smoke
# tests passed, and 24–72h of normal use has produced fresh backups under
# the new path).
docker volume rm twp-prod_pgdata   # if it still exists

# Old pre-rebrand dump file (the rollback artifact from §3.3) — keep at
# least until one fresh backup has succeeded into /data/backups/vakwen.
rm /data/backups/vakwen/pre-rebrand-dump.sql

# Pre-rebrand env file
rm infra/docker/.env.prod.pre-rebrand

# Optional: remove the legacy /data/backups/tw-portfolio directory once
# the rebrand cutover has stabilized AND restore_database_if_possible's
# fallback search of /data/backups/tw-portfolio is no longer load-bearing.
# Recommend keeping it for the first 30 days post-cutover.
# rm -rf /data/backups/tw-portfolio
```

### 6.4 Linear ticket title cleanup

In Linear, edit KZO-92 title:

```
Before: Rebrand platform from TWP to Kewora
After:  Rebrand platform from TW Portfolio to Vakwen
```

Update the Linear project description if it references the old name.

---

## 7. Optional / operator-preference items

These are NOT required for the cutover but improve hygiene:

### 7.1 Local repo directory rename

If you want your local repo dir on the laptop to match the new brand:

```bash
cd ~/repos
mv tw-portfolio vakwen
cd vakwen
git status   # Should be clean

# Update any external references:
# - ~/.codex/MANIFEST.md   (if it points to ~/repos/tw-portfolio)
# - Editor workspaces (close + reopen)
# - Shell aliases
# - tmux session names that mention tw-portfolio
```

This is harmless and reversible. Not required for the PR.

### 7.2 Other clones / dev machines

Same as §7.1 on each machine where you have the repo checked out.

### 7.3 Branch naming convention going forward

Updated in this PR (`docs/git-pr-flow.md`). Future branches can use the new brand vocabulary in their descriptive slugs (e.g. `nocktkv/kzo-200-vakwen-feature-X`). The `kzo-` ticket prefix stays — Linear team `kzokv` is separate from product brand.

### 7.4 Linear team / project rename (DEFERRED — pure UI operation)

If you eventually want the Linear team to match the product brand:

1. Linear → Settings → Team `kzokv` → rename to `vakwen`
2. All `linear.app/kzokv/issue/KZO-XX` URLs auto-redirect to `linear.app/vakwen/issue/KZO-XX`
3. The `KZO-` issue prefix can also be renamed (caution: this rewrites all issue IDs)

**Recommendation: do NOT rename the team or issue prefix.** They're identity artifacts, not brand artifacts. The 102 in-repo references to `linear.app/kzokv/issue/KZO-XX` would all become legacy redirects if you changed it — pure churn for zero value.

### 7.5 Final logo / wordmark / brand identity (DEFERRED — design ticket)

The placeholder favicon in this PR is monochrome and minimal. A future ticket can:

- Design a proper logo / wordmark in vector formats
- Add brand color tokens (or document existing ones)
- Generate full favicon set (16/32/48/96/192/512px + Apple touch icons + maskable)
- Create OG share image (1200x630 PNG)

This is a design discipline, not a code task. Spawn a Linear ticket when the design work is ready.

### 7.6 Domain migration to a Vakwen TLD (DEFERRED — separate ticket)

Future: when trademark is cleared and `vakwen.app` (or similar) is purchased, plan a follow-up ticket to migrate from `*.kzokvdevs.dpdns.org` → `*.vakwen.app`. Steps will mirror this doc but with the additional axes:

- Cookie domain change: `.kzokvdevs.dpdns.org` → `.vakwen.app` (INVALIDATES all sessions)
- New Cloudflare zone setup (or different DNS provider)
- Fresh OAuth client recommended (don't try to migrate the same client across domains)
- SSL cert workflow (Cloudflare handles automatically if using their proxy)
- Communication to users (if any exist by then) about session invalidation

The deferred ticket should reference this transition doc as its analogue.

### 7.7 Trademark clearance (DEFERRED — legal task)

Run the §1.2 checklist seriously through a trademark attorney if Vakwen will be public-facing. The KZO-92 rebrand can proceed without this — it's a working-name commitment, easily reversed if a conflict surfaces.

---

## 8. Touch-point reference (where the rename lands in code)

This is informational — actual code changes are in the rebrand PR. Use this when verifying the PR diff during review.

| Area | Files / paths |
|---|---|
| Display strings | `apps/web/app/layout.tsx`, `apps/web/app/login/page.tsx` |
| README + AGENTS | `README.md`, `AGENTS.md` (root + per-subtree) |
| Docs (evergreen) | `docs/001-architecture/*`, `docs/002-operations/*`, `docs/market-data-platform.md`, `infra/cloudflared/README.md` |
| `.claude/` | `CLAUDE.md`, `memory/*.md`, `rules/*.md` (in-repo only) |
| Package scope | 9 `package.json` files in `libs/*` + `apps/*`, root `package.json` |
| Imports | ~923 sites across `apps/**` + `libs/**` + `scripts/**` |
| Build configs | `tsconfig*.json` paths, `apps/web/vitest.config.ts` aliases |
| CI | `.github/workflows/ci.yml` `-w` flags (29 hits) |
| Env vars | `TWP_STATE_DIR`, `TWP_MANAGED_CI_STACK` (renamed; 55 reference sites) |
| Compose | All 4 `docker-compose*.yml` files |
| Deploy scripts | `infra/scripts/deploy.sh` (29 hits), `infra/scripts/backup-postgres.sh` |
| `.env.example` + fixtures | Root `.env.example`, `infra/docker/.env.local`, `infra/docker/fixtures/env.{dev,prod,local}.ci` |
| Visual placeholders (new) | `apps/web/public/favicon.ico`, `apps/web/public/icon.png`, `apps/web/public/apple-touch-icon.png` |

---

## 9. Glossary

- **Tier C / C1** — chosen rebrand depth: full rename of code + infra + dev/local + prod, but staying on existing host domain `kzokvdevs.dpdns.org`. (Tier C2 would have migrated to a new TLD.)
- **Cookie domain** — the `Domain` attribute on the session cookie. `.kzokvdevs.dpdns.org` means the cookie is valid for any subdomain of that host.
- **OAuth redirect URI** — the URL Google POSTs the authorization code to after user consent. Must exactly match a registered URI in the Google client config.
- **Compose project name** — the `--project-name` flag (or top-level `name:` in compose file). Used as a prefix for auto-generated volume + network names.
- **`pgdata` volume** — Docker named volume that stores the PostgreSQL data directory. Survives container restarts but is destroyed by `docker compose down -v`.
- **Cloudflare Zero Trust tunnel** — outbound connection from the QNAP to Cloudflare's edge that routes inbound requests for the configured hostnames.

---

## 10. Decision provenance

These decisions were locked in the KZO-92 scope-grill session on 2026-05-14:

- Working brand name: **Vakwen** (single-word, no descriptor suffix)
- Depth: **Tier C / C1** (full code+infra rebrand, subdomain rename, sessions preserved)
- DB rename: **ALTER DATABASE** (preserve data)
- Env var migration: **hard cut** (no backward-compat shims)
- Prod cutover: **single window, ~30 min**, no real users to coordinate with

See sibling docs in `docs/004-notes/kzo-92/`:

- `scope-todo-*.md` — implementation steps for the rebrand PR
- (this file) `transition-202605141500-prod-cutover.md` — operator ops walk-through
