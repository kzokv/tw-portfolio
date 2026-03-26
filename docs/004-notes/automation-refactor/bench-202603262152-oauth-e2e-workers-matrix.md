# OAuth E2E Workers Benchmark

**Date:** 2026-03-26
**Status:** Frozen snapshot — do not update after merge
**Context:** Phase 5c — OAuth parallelization (`automation-refactor` worktree)

---

## Purpose

After retiring `auth.setup.ts` and switching to per-test OAuth sessions (`oauth-base` fixture), `playwright.oauth.config.ts` was set to `fullyParallel: true`. This benchmark measured execution time and resource usage at `workers: 1–4` to select a stable, efficient default.

---

## Environment

| Property | Value |
|---|---|
| Machine | macOS, 8 logical CPUs, 16 GB RAM |
| Suite | `npm run test:e2e:oauth:mem` (full command, including npm package builds) |
| Tests | 52 across 8 spec files (`specs-oauth/`) |
| Persistence | memory (`PERSISTENCE_BACKEND=memory`) |
| Auth mode | `oauth` (mock OAuth server, per-test `/__e2e/oauth-session`) |
| Servers | mock-oauth (4445) + API (4000) + Next.js web (3333) |

---

## Results Matrix

| Workers | Wall time | Playwright time¹ | Peak CPU² | Avg CPU² | Peak Mem³ | Passed | Failed |
|--------:|----------:|------------------:|---------:|--------:|---------:|-------:|-------:|
| 1 | 66s | 58s | 356% | 169% | 5,768 MB | 52 | 0 |
| **2** | **72s** | **66s** | **662%** | **264%** | **5,896 MB** | **52** | **0** |
| 3 | 99s | 90s | 724% | 384% | 6,789 MB | 52 | 0 |
| 4 | 126s | 114s | 730% | 389% | 7,280 MB | 50 | **2** |

¹ Playwright-reported time (includes webServer startup; excludes npm package build steps ~6–12s).
² Summed across all `node` + `chromium` processes; 100% = 1 full core.
³ Peak RSS of node + browser processes combined.

**Chosen default: `workers: 2`** (bold row above).

---

## Why More Workers Hurt

Counter-intuitively, higher worker counts increase wall time. Three causes:

**1. Node.js server contention is the bottleneck.**
The API (Fastify) and web app (Next.js) are single-threaded. With N browsers simultaneously minting OAuth sessions, navigating pages, and making API calls, both servers queue requests. Individual test durations bloat sharply:

| Test | N=1 | N=4 |
|---|---|---|
| profile tab visible | 1.2s | 39.2s |
| demo seeded transactions | 1.6s | 42.4s (FAIL) |
| logout clears session | 0.9s | 10.2s |
| stateless session re-use | 2.2s | 10.8s |

**2. Tests are individually fast.**
With 52 tests averaging ~1–2s each (N=1 total: 58s), the fixed overhead of server startup (~35–40s per run) dominates. Parallelism reduces pure test time but cannot reduce that floor — and it increases startup contention at higher worker counts.

**3. N=4 causes flaky failures.**
Both `demo-symbol-history` tests failed at N=4: `symbol-history-section` not found within its 20s `toBeVisible` timeout. The Next.js server was too loaded to finish rendering the ticker page in time. These are infrastructure timeouts, not test logic bugs.

---

## Decision Rationale

`workers: 2` is the stable sweet spot:

- **Correct:** 52/52 pass (vs. 50/52 at N=4).
- **Fast enough:** 72s wall time vs. 66s at N=1 — only 9% slower, within run-to-run noise.
- **Safe margin:** Peak CPU 662% leaves headroom before the saturation cliff that starts visibly at N=3 (99s, 724% CPU).
- **Modest memory:** 5,896 MB — only 128 MB more than N=1, well within the 16 GB budget.

`workers: 1` is marginally faster but loses the parallelism insurance as the suite grows (Phase 5d/5e add more tests). `workers: 3+` degrades both speed and reliability on this single-machine dev/CI setup.

---

## Future Revisit Triggers

Revisit this number if:
- The suite grows past ~100 tests (more work to parallelize may tip the balance)
- The test servers are separated from the test runner (e.g., dedicated CI machines)
- API or Next.js servers move to multi-process/cluster mode
