# Commit Message Format

All commits must follow: `type(scope): KZO-XX: subject`

- `type` — `feat`, `fix`, `chore`, `docs`, `refactor`, `test`
- `scope` — affected workspace or layer (e.g. `api`, `web`, `db`, `config`)
- `KZO-XX` — Linear ticket reference (mandatory)
- `subject` — imperative, lowercase, no period

**Examples:**
```
feat(api): KZO-150: add sweepSlidingWindowBucket eviction sweep
fix(web): KZO-113: propagate CORS headers through SSE writeHead
chore(memory): KZO-147: refresh progress, demote stale reference entries
```

**Why:** Ticket reference enables Linear ↔ git traceability. Consistent type+scope makes `git log` filterable by layer. All commits in this repo follow this format — deviating breaks the pattern visible in `git log --oneline`.

**How to apply:** Every commit, including chore/memory commits. Co-Authored-By trailer is added by Claude Code automatically.

## Per-PR waiver (user decision required, gate-enforced schema)

When a PR has no dedicated Linear ticket and the user explicitly decides to omit the `KZO-XX:` segment, waiver mode is permitted under these conditions:

1. The user makes the decision explicitly (never the agent's initiative).
2. The PR carries the **`waiver:linear-ticket`** label (added at `gh pr create --label` or via the PR UI).
3. The PR body contains a literal `## Waiver` section (heading exactly that) with three fields:
   - `Reason: <one paragraph explaining why no ticket exists>`
   - `Approved-by: @<github-handle>` (the approver must have write/maintain/admin on the repo; the author may self-approve only when they are the sole human collaborator with write access)
   - `Scope: title|commits|both` (must match the actual violation surface — if both PR title AND commit subjects omit the ticket, use `Scope: both`)
4. Commits still follow `type(scope): subject` — only the ticket segment is omitted.
5. The decision is tracked in `state.json` `open_user_decisions` until resolved (when a `/team` run is in flight).

**Do NOT use `## Notes` for this purpose.** The repo's `.github/workflows/pr-gate.yml` parses `## Waiver` specifically; any other heading is invisible to the gate. A waiver written under `## Notes` (or any other heading) WILL fail CI with the message `Strict naming violations require the \`waiver:linear-ticket\` label to activate waiver mode.` even if the label is applied.

**Canonical reference:** see `.github/workflows/pr-gate.yml` for the exact regexes; the schema above mirrors them. See `.worklog/team/pr-description-draft.md` from the admin-ui-bugs PR (2026-05-12) for a concrete example of a correctly-structured waiver section.

Do NOT self-waive as an agent — the ticket-prefix decision requires an explicit user choice. If the user has not decided, escalate via `[ESCALATE]` after Phase 5 clean and before Wave 2 starts.

First recorded waiver: admin-ui-bugs PR (2026-05-12).

**Why this is a rule:** Wave 2 of the admin-ui-bugs `/team` run produced a PR draft using `## Notes` for the waiver text, which would have failed `pr-gate.yml` on submission. Caught by a /codex:adversarial-review pass post-shutdown. The cost of catching it pre-PR was small; catching it post-PR would have wasted a CI cycle and required a body edit. Promoting to this rule prevents repeat.
