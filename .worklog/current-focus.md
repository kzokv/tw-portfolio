# Current Focus

## Active goal
- Execute `KZO-24` as the current pickup: establish canonical trade posting with linked cash-ledger generation and reduce dependency on legacy trade storage.

## Constraints
- Follow the Linear execution queue rather than the older PRD wave order for implementation pickup.
- Do not pull Wave 3 or Wave 4 work forward until Wave 2 canonical write-path contracts and quality gates are in place.
- Preserve lot-capable inventory and deterministic disposal behavior even though Taiwan MVP reports weighted-average views.
- Expect transitional legacy seams in Postgres loading and recompute routes until canonical cutover work is completed.

## Immediate next check
- Inspect `KZO-24` scope against `apps/api/src/routes/registerRoutes.ts`, `apps/api/src/persistence/postgres.ts`, and the canonical accounting migrations before changing write-path behavior.
