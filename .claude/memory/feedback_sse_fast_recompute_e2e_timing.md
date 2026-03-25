---
name: sse_fix_enables_fast_recompute_e2e_timing
description: Fixing SSE type forwarding makes recompute events fire immediately, making intermediate UI states unobservable in E2E tests
type: feedback
---

E2E assertions on mutation status must accept BOTH intermediate states ("Recomputing...") AND final states ("recomputed successfully", "Portfolio updated") in the same regex. When SSE works correctly, the recompute_complete event fires before Playwright's polling assertion can observe the intermediate state.

**Why:** The SSE type mismatch fix (useEventStream.ts line 72) made SSE events flow through handleSSEEvent for the first time. Previously, event.type was always undefined so the discriminated union checks silently failed, and the 10s safety net was the only path to resolution. With SSE working, recompute completes in <100ms — too fast for E2E polling.

**How to apply:** When writing E2E assertions that check mutation/recompute status messages, always use regexes that accept both the intermediate and final states. Example: `/Recomputing|recomputed successfully|Portfolio updated/i` instead of `/Recomputing/i`.
