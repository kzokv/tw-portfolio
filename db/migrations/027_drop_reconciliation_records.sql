-- Drop the dead reconciliation_records table (zero live code paths; only
-- demoCleanup.ts referenced it and that DELETE is removed in this PR).
-- Indexes on reconciliation_records are auto-dropped with the table.
DROP TABLE IF EXISTS reconciliation_records;

-- Enforce posting/reconciliation status coupling at the DB level.
ALTER TABLE dividend_ledger_entries
  DROP CONSTRAINT IF EXISTS ck_dividend_ledger_entries_reconciliation_coupling;

ALTER TABLE dividend_ledger_entries
  ADD CONSTRAINT ck_dividend_ledger_entries_reconciliation_coupling
  CHECK (
    (posting_status = 'expected' AND reconciliation_status = 'open')
    OR posting_status IN ('posted', 'adjusted')
  );
