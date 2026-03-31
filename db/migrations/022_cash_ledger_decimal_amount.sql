-- KZO-124 follow-up: migration 020 converted trade_events/lots/lot_allocations
-- price columns to NUMERIC(20,2) but missed cash_ledger_entries.amount (still
-- INTEGER). ETF decimal prices (e.g. 185.50) produce fractional settlements
-- that fail on INSERT with "invalid input syntax for type integer".

ALTER TABLE cash_ledger_entries
  ALTER COLUMN amount TYPE NUMERIC(20, 2);
