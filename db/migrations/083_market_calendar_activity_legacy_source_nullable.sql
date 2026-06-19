DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'market_data'
       AND table_name = 'market_calendar_activity'
       AND column_name = 'source'
  ) THEN
    UPDATE market_data.market_calendar_activity
       SET source = COALESCE(source, source_kind, 'system')
     WHERE source IS NULL;

    ALTER TABLE market_data.market_calendar_activity
      ALTER COLUMN source SET DEFAULT 'system',
      ALTER COLUMN source DROP NOT NULL;
  END IF;
END $$;
