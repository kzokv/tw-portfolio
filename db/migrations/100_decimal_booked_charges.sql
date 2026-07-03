-- Decimal-capable booked charges for commission/tax. Forward-only schema
-- change: accept exact source-provided values up to 4 decimal places without
-- integer coercion.

ALTER TABLE trade_events
  ALTER COLUMN commission_amount TYPE NUMERIC(20, 4) USING commission_amount::NUMERIC(20, 4),
  ALTER COLUMN tax_amount TYPE NUMERIC(20, 4) USING tax_amount::NUMERIC(20, 4);

ALTER TABLE lots
  ALTER COLUMN total_cost_amount TYPE NUMERIC(20, 4) USING total_cost_amount::NUMERIC(20, 4);

ALTER TABLE lot_allocations
  ALTER COLUMN allocated_cost_amount TYPE NUMERIC(20, 4) USING allocated_cost_amount::NUMERIC(20, 4);

ALTER TABLE cash_ledger_entries
  ALTER COLUMN amount TYPE NUMERIC(20, 4) USING amount::NUMERIC(20, 4);

ALTER TABLE recompute_job_items
  ALTER COLUMN previous_commission_amount TYPE NUMERIC(20, 4) USING previous_commission_amount::NUMERIC(20, 4),
  ALTER COLUMN previous_tax_amount TYPE NUMERIC(20, 4) USING previous_tax_amount::NUMERIC(20, 4),
  ALTER COLUMN next_commission_amount TYPE NUMERIC(20, 4) USING next_commission_amount::NUMERIC(20, 4),
  ALTER COLUMN next_tax_amount TYPE NUMERIC(20, 4) USING next_tax_amount::NUMERIC(20, 4);

ALTER TABLE trade_fee_policy_snapshot_tax_components
  ALTER COLUMN booked_tax_amount TYPE NUMERIC(20, 4) USING booked_tax_amount::NUMERIC(20, 4);
