---
step: 4 of 5
commit_name: "3: TypeScript canonical types"
depends_on: 03-market-data-schema.md
ticket: KZO-82
---

# Step 04 — TypeScript canonical types

**Depends on:** Step 03 (schema must exist before defining persistence types that map to it)

## 4.1 — Domain types

- [ ] Add to `libs/domain/src/types.ts`:
  ```ts
  export interface InstrumentRef {
    ticker: string;
    instrumentType: InstrumentType;
    marketCode: MarketCode;
    name?: string;
    isProvisional: boolean;
    lastSyncedAt?: string | null;
  }

  export interface QuoteSnapshot {
    ticker: string;
    close: number;
    asOf: string;
    source: string;
    isProvisional: boolean;
  }

  export interface DailyBar {
    ticker: string;
    barDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    source: string;
    ingestedAt: string;
  }

  export type BackfillStatus = "pending" | "backfilling" | "ready" | "failed";
  export type VerificationStatus = "unverified" | "verified" | "mismatch";
  ```

## 4.2 — Persistence types

- [ ] Add `InstrumentRow` to `apps/api/src/types/` or `apps/api/src/persistence/`:
  ```ts
  export interface InstrumentRow extends InstrumentRef {
    listedDate?: string;
    delistedAt?: string;
    statusReason?: string;
    barsBackfillStatus: BackfillStatus;
    verificationStatus: VerificationStatus;
    verificationNote?: string;
    createdAt: string;
    updatedAt: string;
  }
  ```

## 4.3 — Exports

- [ ] Update `libs/domain/src/index.ts` — export all new types:
  - `InstrumentRef`, `QuoteSnapshot`, `DailyBar`, `BackfillStatus`, `VerificationStatus`
- [ ] Verify no circular imports introduced

## 4.4 — Verify

- [ ] `npm run typecheck` passes
- [ ] `npx eslint .` passes
