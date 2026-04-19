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
