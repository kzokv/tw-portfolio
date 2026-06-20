DO $$
DECLARE
  detail_type TEXT;
BEGIN
  SELECT udt_name
    INTO detail_type
    FROM information_schema.columns
   WHERE table_schema = 'market_data'
     AND table_name = 'provider_operation_logs'
     AND column_name = 'detail';

  IF detail_type = 'jsonb' THEN
    ALTER TABLE market_data.provider_operation_logs
      ALTER COLUMN detail DROP DEFAULT,
      ALTER COLUMN detail DROP NOT NULL;

    ALTER TABLE market_data.provider_operation_logs
      ALTER COLUMN detail TYPE TEXT
      USING CASE
        WHEN detail IS NULL THEN NULL
        WHEN jsonb_typeof(detail) = 'string' THEN detail #>> '{}'
        WHEN detail = '{}'::jsonb THEN NULL
        ELSE detail::text
      END;

  ELSIF detail_type = 'text' THEN
    ALTER TABLE market_data.provider_operation_logs
      ALTER COLUMN detail DROP DEFAULT,
      ALTER COLUMN detail DROP NOT NULL;
  END IF;
END $$;
