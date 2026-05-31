-- KZO-124: Migrate ledger price/cost columns from INTEGER to NUMERIC(20,2)
-- for decimal price support (TWSE ETF NAVs, odd-lot trades).
-- Fee columns (commission_amount, tax_amount) intentionally stay INTEGER.

ALTER TABLE trade_events
  ALTER COLUMN unit_price TYPE NUMERIC(20, 2);

ALTER TABLE lots
  ALTER COLUMN total_cost_amount TYPE NUMERIC(20, 2);

ALTER TABLE lot_allocations
  ALTER COLUMN allocated_cost_amount TYPE NUMERIC(20, 2);
