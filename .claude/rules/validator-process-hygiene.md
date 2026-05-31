# Validator Process Hygiene — Tear Down Anything You Spawn

The Validator's visual-verification step (Tier 2-3, when a UI change is in scope) MUST clean up any dev server, headless browser, or background process it spawned before reporting `[DONE]`. The Architect's pre-shutdown idle check looks at `TaskList`, not at OS-level orphan processes — so leaked processes don't block shutdown but DO break the next pre-push gate run.

## The failure mode

Validator runs `npm run dev` in a tmux pane to load `/some-page` in Chrome DevTools MCP for screenshots, then sends `[DONE:CLEAN]`. The Architect ships `[SHUTDOWN]` claiming all 8 suites green. The user's fresh-shell pre-push gate (`npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`) aborts Suite 6 immediately:

```
Error: http://localhost:4000/health/live is already used,
make sure that nothing is running on the port/url or set
reuseExistingServer:true in config.webServer.
```

Port 4000 is held by the orphan `tsx watch src/server.ts` from the leaked `npm run dev`. The team's tests are genuinely fine — only process hygiene was wrong. The user has to `lsof -i :4000` + `kill <PID>` before re-running. From outside the team, this looks like a code regression.

## The rule

**Do NOT use `npm run dev` for visual verification.**

Preferred order:
1. **Use the running E2E webServer.** Suite 6 / 7's Playwright config already starts the API on 4000 and the web on 3333. Open Chrome DevTools MCP / Playwright MCP against those — you piggyback on their lifecycle and inherit their teardown.
2. **If a separate dev server is unavoidable** (e.g. you need a specific seed state that the test webServer doesn't provide): bind to a non-default port (`API_PORT=4099 npm run dev`) AND `kill` the PID before sending `[DONE]`. Track the PID at spawn time; do not rely on `pkill` patterns that may sweep unrelated processes.
3. **Architect pre-shutdown check** (extension to the existing pre-shutdown idle gate): before `[SHUTDOWN]`, run `lsof -i :4000 -i :3333 -i :4445 -i :4099`. Any orphan PIDs → `[FORCE_STOP]` first.

## Diagnosing orphans on the consumer side

If a fresh-shell pre-push gate aborts with `health/live already used` (or any "port already in use" on 4000 / 3333 / 4445), check `lsof` BEFORE treating it as a code regression:

```bash
lsof -i :4000 -i :3333 -i :4445
```

A `tsx watch` or `npm run dev` PID with `PPID=1` (detached, so the parent tmux pane is gone) is almost always a leaked dev server from a prior `/team` run. `kill <PID>` and re-run.

**Why:** KZO-167 — Architect reported 8/8 suites green at iter 2. User's pre-push gate failed Suite 6 immediately because a `npm run dev` from the Validator's visual verification (PID 27873 → tsx watch → Fastify on port 4000) was still bound. After `kill 27873` the same gate passed verbatim with the team's reported counts (lint clean / typecheck clean / 292 / 833 / 527 / 178 / 83 / 155).

**How to apply:**
- Validator role at all tiers: prefer the E2E webServer for screenshots; if you must spawn a separate process, track its PID and kill it before `[DONE]`.
- Architect role at all tiers: extend the pre-shutdown idle check with the `lsof` sweep above.
- Any PR that introduces a new visual-verification recipe in scope-todos or team-skill references must specify the cleanup step explicitly.
