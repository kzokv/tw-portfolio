# Debate: Q11 — dev.sh Banner Rework + Script Name Passing
> Date: 2026-03-22
> Participants: Architect, Backend Engineer, DevOps Engineer, QA Engineer
> Topic: How should dev.sh know which script invoked it (for the startup banner header), and how should the banner be designed?

## Options Under Consideration

### Main Question: Script Name Passing

**Option A — Positional argument:**
```json
"dev:local:bypass:mem": "AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory bash scripts/dev.sh dev:local:bypass:mem"
```
dev.sh reads `$1` for the banner title.

**Option B — Derive from env vars:**
dev.sh constructs the name dynamically from `AUTH_MODE` and `PERSISTENCE_BACKEND` values (e.g., `oauth` + `postgres` → `dev:local:oauth:pg`).

**Option C — Dedicated env var:**
```json
"dev:local:bypass:mem": "DEV_SCRIPT_NAME=dev:local:bypass:mem AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory bash scripts/dev.sh"
```

### Sub-Questions

1. Which vars should be "mode-specific" vs "inherited"?
2. Should the banner show vars that aren't set (e.g., `DB_URL` when `PERSISTENCE_BACKEND=memory`)?
3. Should sensitive values (`SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`) be masked or omitted?
4. Should the banner be printed before or after the Node version check?

## Debate Rounds

### Round 1

**Architect:** I favor **Option B — derive from env vars**. The script name is semantically determined by `AUTH_MODE` and `PERSISTENCE_BACKEND` — those are the mode axes. Building it from those values means the banner is always truthful. With Options A and C, there's a coupling problem: someone can write `DEV_SCRIPT_NAME=dev:local:oauth:pg AUTH_MODE=dev_bypass ...` and the banner lies. The derivation map is tiny — two vars, a few values each. For the sub-questions: mode-specific should be vars that change across script variants (`AUTH_MODE`, `PERSISTENCE_BACKEND`, `DB_URL`, `SESSION_SECRET`); inherited are the stable defaults (`NODE_ENV`, `API_PORT`, `WEB_PORT`, `ALLOWED_ORIGINS`, etc.). Banner should print *after* the Node check — no point showing a pretty banner then immediately dying.

**Backend Engineer:** I disagree on Option B. The script names aren't purely mechanical derivations from env vars. Look at the design doc: `dev:local:oauth:pg` — where does "local" come from? Where does "pg" come from as a shorthand for "postgres"? You'd need a mapping table inside dev.sh to turn `PERSISTENCE_BACKEND=postgres` into `pg` and `memory` into `mem`. That's logic that duplicates what the npm script name already knows. **Option A — positional arg** is the simplest: the npm script already has the name, just pass it. `$1` in shell is trivial to read. Zero ambiguity, zero derivation logic, zero mapping tables. If someone invokes `bash scripts/dev.sh` directly without a name, default to "dev" or derive a fallback. For sub-questions: I'd omit unset vars entirely — showing `DB_URL` as empty when running in memory mode just creates confusion.

**DevOps Engineer:** I'm with Option A on simplicity, but I want to push back on one thing the Architect said: the "lying banner" concern is overblown. If someone manually edits the env var prefix on their npm script line, they've already made a conscious decision to go off-road. We shouldn't design around adversarial self-sabotage in a DX script. That said, I think the more important concern is **reusability for dev-docker.sh**. The banner function will be in `scripts/lib/banner.sh`. For Docker dev, the context prefix is `dev:docker:*` not `dev:local:*`. With Option B, you'd need different derivation logic per caller — dev.sh maps to `dev:local:*`, dev-docker.sh maps to `dev:docker:*`. That's extra complexity. With Option A, each caller just passes its own name. Clean separation. For sensitive vars: mask them. Show `SESSION_SECRET=****b3f2` (last 4 chars). Devs need to verify the secret is set and roughly which one; they don't need the full value in terminal output.

**QA Engineer:** From a testability and debuggability perspective, I care most about the banner being accurate, not clever. When a developer pastes terminal output into a bug report, I need to trust the banner. Option B concerns me because the derivation logic becomes a source of bugs itself — what happens when someone adds a new `PERSISTENCE_BACKEND` value and forgets to update the mapping? The banner shows `dev:local:oauth:undefined`. Option A is straightforward and testable: the name is what you pass. For sub-question 2, I strongly agree with the Backend Engineer — omit vars that don't apply. Showing `DB_URL=` (empty) when `PERSISTENCE_BACKEND=memory` actively misleads. For sub-question 4, banner after Node check makes sense — fail fast, decorate later.

### Round 2

**Architect:** The Backend Engineer raises a fair point about the mapping table for shorthand names. Let me reconsider. The `local` segment isn't an env var at all — it's the deployment context (bare-metal vs Docker). That genuinely is caller-specific context that env vars don't capture. I'll concede that pure derivation (Option B) can't produce the full name without additional context. But I still dislike Option A's duplication. The name appears in three places: the npm script key, the positional arg, and the banner output. Option C at least makes the intent explicit as a named env var. What if we combine approaches: **Option A with a derivation fallback**? Pass `$1` if available; if not, derive a best-effort name from env vars. This way direct `bash scripts/dev.sh` invocations still get a reasonable banner.

**Backend Engineer:** That hybrid approach is fine but let's be honest — the fallback path will almost never be hit. The npm scripts are the intended entry points. Direct `bash scripts/dev.sh` invocation is an edge case. I'd rather keep it simple: if `$1` is empty, print `dev` as the header. Don't over-engineer the fallback. On the three-places duplication concern: the npm script key and the arg are adjacent in the same `package.json` line. That's not real duplication — it's co-located. You'd have to actively try to make them diverge. Option C's `DEV_SCRIPT_NAME` env var adds a variable that has no meaning to any downstream process. It exists solely for the banner. That's a code smell — env vars should configure behavior, not cosmetics.

**DevOps Engineer:** I want to settle the "mode-specific vs inherited" question with a concrete list. Looking at `.env.example` and the design doc, here's my proposed split:

Mode-specific (vary by script variant):
- `AUTH_MODE`
- `PERSISTENCE_BACKEND`
- `DB_URL` (postgres only)
- `REDIS_URL` (postgres only, if used)
- `SESSION_SECRET` (oauth only)
- `GOOGLE_CLIENT_ID` (oauth only)
- `GOOGLE_CLIENT_SECRET` (oauth only)
- `GOOGLE_REDIRECT_URI` (oauth only)

Inherited (stable defaults, rarely change):
- `NODE_ENV`
- `API_PORT`
- `WEB_PORT`
- `ALLOWED_ORIGINS`
- `SESSION_COOKIE_NAME`
- `APP_BASE_URL`
- `NEXT_PUBLIC_AUTH_MODE` (derived)
- `NEXT_PUBLIC_API_BASE_URL` (derived)

The key principle: mode-specific vars are the ones that distinguish one `dev:*` script from another. Inherited vars are shared across all variants. On the sensitive values debate: I maintain masking is better than omitting. If `SESSION_SECRET` is empty when you're running oauth mode, that's a critical misconfiguration. The banner should surface that — showing `SESSION_SECRET=<not set>` is more valuable than hiding it entirely.

**QA Engineer:** DevOps's variable classification looks solid. I'd add one refinement: `COOKIE_DOMAIN` should be in the mode-specific section too — it's empty for local dev but set for Docker. For the masking approach, I agree with DevOps but want to specify the format. I'd propose: set values show `****` (fixed length, no partial reveal), unset values show `<not set>`. Showing even the last 4 chars of a secret in terminal output is a risk if someone screenshots or screen-shares. The important signal is "set" vs "not set", not the value. For the main question, I'm now firmly on **Option A** with a simple `dev` fallback when `$1` is empty. The Backend Engineer's argument about co-location in `package.json` convinced me.

### Round 3

**Architect:** I'm moving to Option A as well. The deployment-context argument was decisive — `local` vs `docker` genuinely can't be derived from env vars. Let me propose the concrete API for the shared banner function:

```bash
# scripts/lib/banner.sh
print_banner() {
  local script_name="${1:-dev}"
  # Reads AUTH_MODE, PERSISTENCE_BACKEND, etc. from environment
  # Prints the two-section banner
}
```

Called from dev.sh as `print_banner "$1"` and from dev-docker.sh as `print_banner "$1"`. Both callers pass their name via `$1` from the npm script. One remaining question: should the banner function itself decide which vars are mode-specific based on the current `AUTH_MODE` and `PERSISTENCE_BACKEND`, or should the caller pass a var list? I think the function should own the logic — it knows the schema, the callers shouldn't have to enumerate vars.

**Backend Engineer:** Agreed — the banner function should own the variable classification. It reads the env, applies the mode-specific/inherited split internally. This keeps callers to a single line: `print_banner "$1"`. For the conditional display logic: when `PERSISTENCE_BACKEND=memory`, the function simply doesn't include `DB_URL` or `REDIS_URL` in the mode-specific section. When `AUTH_MODE=dev_bypass`, it doesn't include `SESSION_SECRET`, `GOOGLE_CLIENT_*`, or `GOOGLE_REDIRECT_URI`. This is cleaner than showing empty values. The function has two responsibilities: (1) classify vars by mode, (2) conditionally include vars by mode. That's a reasonable scope for ~40 lines of bash.

**DevOps Engineer:** I agree on the function owning the logic. One implementation detail: for dev-docker.sh, the var set is different — it'll include `PUBLIC_DOMAIN_WEB`, `PUBLIC_DOMAIN_API`, `CLOUDFLARE_TUNNEL_TOKEN`, Docker-specific infra vars. So the function needs to handle two different "inherited" sets. I'd solve this with a second optional parameter — a context flag like `local` or `docker` — that selects which inherited-var list to display. The function signature becomes:

```bash
print_banner() {
  local script_name="${1:-dev}"
  local context="${2:-local}"  # "local" or "docker"
}
```

This keeps the caller simple and the function handles the rest. On the masking debate: I'll concede to QA's point about fixed-length masking. `****` for set values, `<not set>` for unset. No partial reveal. The security argument outweighs the convenience of partial reveal.

**QA Engineer:** The two-parameter API (`script_name` + `context`) is clean. I want to flag one edge case for the conditional var display: what about `COOKIE_DOMAIN`? It's relevant in oauth mode (not bypass) AND in docker context (not local). It's a cross-cutting concern. The function needs to handle combinations: `AUTH_MODE × PERSISTENCE_BACKEND × context`. As long as the conditionals are straightforward if-blocks (not a matrix), this stays manageable. I'd also suggest the function should print a blank line before the banner and after it, for visual separation from the npm/shell noise that precedes it. The design doc's box-drawing format (`──`) is clean and scannable.

### Round 4

**Architect:** Let me address QA's cross-cutting concern. I think the simplest model is three independent filters:
1. Auth filter: `AUTH_MODE=oauth` → include `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_DOMAIN`
2. Persistence filter: `PERSISTENCE_BACKEND=postgres` → include `DB_URL`, `REDIS_URL`
3. Context filter: `context=docker` → include `PUBLIC_DOMAIN_*`, `CLOUDFLARE_TUNNEL_TOKEN`, Docker infra vars

Each variable has a "show when" condition. This avoids matrix explosion — it's just three independent checks per variable. The mode-specific section shows the union of all applicable vars. The inherited section is the constant set minus any that were claimed by mode-specific.

Let me also settle the banner timing question definitively. The sequence should be:
1. Node version check (fail fast, no output on success)
2. Load `.env.local`
3. Derive `NEXT_PUBLIC_*`
4. **Print banner** (now we have all resolved values)
5. Start dev processes

This order means the banner shows the final, effective values after all derivation. That's the whole point of the banner — confirming what the developer is actually running with.

**Backend Engineer:** Architect's filter model is right. Each var has a predicate; we evaluate it; include or exclude. No matrix needed. I want to nail down one final detail: the header line format. The design doc shows:

```
── dev:local:oauth:pg ──────────────────────────
```

That's the script name from `$1`. The banner width should be fixed (e.g., 48 chars) so it looks consistent regardless of name length. The padding dashes fill the remaining width. This is a 3-line implementation:

```bash
local header="── ${script_name} "
local pad_len=$(( 48 - ${#header} ))
printf '%s%*s\n' "$header" "$pad_len" '' | tr ' ' '─'
```

For the footer, just a solid line of 48 `─` chars. Clean, minimal, no box-drawing complexity.

**DevOps Engineer:** Agreed on all technical points. I want to address one more practical concern: when developers run `npm run dev` (the existing bare script, no mode prefix), what happens? Currently `package.json` has `"dev": "bash scripts/dev.sh"` with no env var prefix and no positional arg. The banner should handle this gracefully. With our approach, `$1` is empty, so `script_name` defaults to `dev`. The mode-specific section shows `AUTH_MODE=dev_bypass` and `PERSISTENCE_BACKEND=memory` (the defaults from `.env.local` or hardcoded defaults). This is actually great — it surfaces the effective defaults, which is exactly what a confused developer needs to see.

**QA Engineer:** Excellent point. The `npm run dev` case is the most common path and it "just works" with the fallback default. I'm satisfied with all the decisions. Let me enumerate what we've agreed on:
1. **Option A** with `$1`, defaulting to `dev`
2. Mode-specific = vars that change by script variant, conditionally shown by auth/persistence/context filters
3. Omit vars that don't apply (not empty, just absent)
4. Sensitive values: `****` when set, `<not set>` when unset
5. Banner prints after Node check and env resolution, before process startup
6. Shared function in `scripts/lib/banner.sh` with signature `print_banner <name> [context]`
7. Fixed-width banner (48 chars) with `──` border style

### Round 5

**Architect:** One last thing I want to get right before we close: the `NEXT_PUBLIC_*` derived vars. They appear in the design doc's "Inherited" section (`NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_API_BASE_URL`). But they're *derived* from other vars — they're not independently configured. I think they should be shown but visually marked as derived. Something like:

```
  Inherited:
    NODE_ENV               development
    API_PORT               4000
    WEB_PORT               3333
    ALLOWED_ORIGINS        http://localhost:3333,...
    SESSION_COOKIE_NAME    __Host-g_auth_session
    APP_BASE_URL           http://localhost:3333

  Derived:
    NEXT_PUBLIC_AUTH_MODE       ← AUTH_MODE
    NEXT_PUBLIC_API_BASE_URL   ← http://localhost:4000
```

Or is that over-designing it? Maybe just include them in inherited and move on.

**Backend Engineer:** That's over-designing it. Two sections is the right level: mode-specific and inherited. The `NEXT_PUBLIC_*` vars go in inherited. They're stable across invocations — they derive from the same env that's already visible in the banner. A developer who cares about the derivation logic can read the 2 lines of bash in dev.sh. Adding a third "Derived" section adds visual complexity for marginal information gain. Keep it to two sections.

**DevOps Engineer:** Agree with Backend — two sections. I'd also point out that for the Docker context, `NEXT_PUBLIC_*` derivation might work differently (they may be set explicitly rather than derived). Having a third section that says "Derived" would be confusing in the Docker case where they're actually explicit. Two sections, both contexts, consistent structure. Let's close this.

**QA Engineer:** Agreed. Two sections. The banner's job is to show effective values, not explain how they got there. Derivation logic is an implementation detail. I'm satisfied with all decisions. No dissent on any point.

## Key Arguments Summary

| Question | Decision | Rationale |
|----------|----------|-----------|
| Script name passing | **Option A — positional arg** (`$1`) | Co-located with npm script name in `package.json`; no mapping table needed; handles `local` vs `docker` context that env vars can't express; defaults to `dev` when omitted |
| Mode-specific vs inherited | Auth/persistence/context filters per var | Each var has an independent "show when" predicate; avoids matrix explosion; mode-specific = changes across variants, inherited = stable defaults |
| Show unset vars? | **No — omit entirely** | Showing `DB_URL=` in memory mode misleads; absence = not applicable is clearer than empty values |
| Mask sensitive values? | **Yes — `****` (set) / `<not set>` (unset)** | Fixed-length mask avoids leaking even partial secrets; "set vs not set" is the diagnostic signal developers need |
| Banner timing | **After Node check + env resolution, before process startup** | Fail fast before decoration; show final effective values after all derivation |
| Banner function API | `print_banner <name> [context]` in `scripts/lib/banner.sh` | Shared between dev.sh and dev-docker.sh; function owns var classification; callers pass only name + context |
| Section count | **Two: mode-specific + inherited** | Adding a "Derived" section over-engineers for marginal value; NEXT_PUBLIC_* goes in inherited |
| Banner width | **48 chars, `──` border style** | Consistent visual width; matches design doc format |

## Consensus Decision

**Unanimous on all points.** No dissent recorded.

1. **Script name: Option A (positional arg).** npm scripts pass the name as `$1`. When omitted (e.g., `npm run dev`), defaults to `dev`. This is the simplest approach, avoids derivation logic, and naturally handles the `local` vs `docker` distinction that env vars cannot express.

2. **Variable classification uses three independent filters** (auth mode, persistence backend, deploy context). Each variable has a "show when" predicate. Mode-specific shows the union of applicable vars; inherited is the constant baseline.

3. **Unset/inapplicable vars are omitted entirely** from the banner — not shown as empty.

4. **Sensitive values are masked** with fixed-length `****` when set, or `<not set>` when not set. No partial value reveal.

5. **Banner prints after** the Node version check, `.env.local` loading, and `NEXT_PUBLIC_*` derivation — so it reflects the final effective environment.

6. **Two sections only**: mode-specific and inherited. `NEXT_PUBLIC_*` vars go in inherited.

7. **Shared function** in `scripts/lib/banner.sh` with signature `print_banner <name> [context]`. The function owns all variable classification logic. Callers are one-liners.

## Action Items

1. **Create `scripts/lib/banner.sh`** with `print_banner()` function:
   - Accept `$1` (script name, default `dev`) and `$2` (context, default `local`)
   - Implement three-filter variable classification (auth, persistence, context)
   - Fixed 48-char width, `──` border style
   - Mask secrets with `****` / `<not set>`
   - Omit vars whose filter predicate is false

2. **Update `scripts/dev.sh`**:
   - Source `scripts/lib/banner.sh`
   - Add `print_banner "${1:-dev}"` call after `NEXT_PUBLIC_*` derivation (line 48), before process startup (line 50)

3. **Add npm scripts** to root `package.json` for each dev variant:
   ```json
   "dev:local:bypass:mem": "AUTH_MODE=dev_bypass PERSISTENCE_BACKEND=memory bash scripts/dev.sh dev:local:bypass:mem",
   "dev:local:oauth:pg": "AUTH_MODE=oauth PERSISTENCE_BACKEND=postgres bash scripts/dev.sh dev:local:oauth:pg"
   ```

4. **Reserve `context=docker`** var set for KZO-105 (dev-docker.sh). Document the planned Docker-specific inherited vars (`PUBLIC_DOMAIN_*`, `CLOUDFLARE_TUNNEL_TOKEN`, etc.) but don't implement until that ticket.
