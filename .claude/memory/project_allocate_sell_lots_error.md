---
name: allocateSellLots throws plain Error — replay must catch and wrap
description: allocateSellLots throws plain Error with no trade context — replay must catch and enrich for recompute_failed payload
type: project
---

`allocateSellLots` in `lot.ts` throws `new Error("Insufficient quantity to sell")` — a plain Error with no `statusCode`, no trade ID, and no shortfall amount. When this throws during `replayPositionHistory`, the `recompute_failed` event needs context-enriched information.

**Why:** KZO-114 debate. The client-side negative-lots check warns the user but doesn't block, so this error path will be hit in production (e.g., user deletes a BUY that preceded SELLs). A raw "Insufficient quantity to sell" in a `recompute_failed` SSE payload is not actionable.

**How to apply:** Wrap the `allocateSellLots` call in `replayPositionHistory` with try/catch. Re-throw or emit `recompute_failed` with context (trade date, symbol, shortfall quantity).
