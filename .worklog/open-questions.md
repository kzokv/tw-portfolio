# Open Questions

## Outstanding questions
- When should the legacy `POST /corporate-actions` dividend write path be frozen or retired now that first-class dividend declaration and posting routes exist?
- Should stock-dividend posting continue using zero-cost lot insertion until a dedicated non-cash position-event model exists, or should that model be pulled forward before more dividend workflow is built on top?
- When should reversal plus replacement API support land so dividend corrections fully satisfy the `KZO-33` lifecycle contract?

## Needed context
- Inspect `apps/api/src/routes/registerRoutes.ts`, `apps/api/src/services/dividends.ts`, and any remaining callers of the legacy corporate-action dividend path to decide whether the old endpoint should be blocked for dividend writes or removed entirely.
- Inspect the canonical accounting and lifecycle docs plus future inventory tickets to decide whether zero-cost lot insertion is an acceptable temporary stock-dividend bridge.
- Inspect the dividend lifecycle contract and persistence invariants to scope the smallest reversal/supersession API slice that closes the current correction gap.
