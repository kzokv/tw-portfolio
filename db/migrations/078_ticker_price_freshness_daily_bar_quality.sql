-- Ticker price freshness: distinguish canonical OHLCV bars from close-only fallbacks.
--
-- Keep the fresh-deploy path metadata-only on large daily_bars tables. On
-- modern Postgres, adding a NOT NULL column with a constant DEFAULT does not
-- rewrite existing rows; a separate add-then-update would.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'market_data'
      AND table_name = 'daily_bars'
      AND column_name = 'quality'
  ) THEN
    ALTER TABLE market_data.daily_bars
      ADD COLUMN quality TEXT NOT NULL DEFAULT 'full_bar';
  ELSE
    ALTER TABLE market_data.daily_bars
      ALTER COLUMN quality SET DEFAULT 'full_bar';

    UPDATE market_data.daily_bars
    SET quality = 'full_bar'
    WHERE quality IS NULL;

    ALTER TABLE market_data.daily_bars
      ALTER COLUMN quality SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_bars_quality_check'
      AND conrelid = 'market_data.daily_bars'::regclass
  ) THEN
    ALTER TABLE market_data.daily_bars
      ADD CONSTRAINT daily_bars_quality_check
      CHECK (quality IN ('full_bar', 'close_only'));
  END IF;
END $$;

COMMENT ON COLUMN market_data.daily_bars.quality IS
  'Bar completeness for ticker price freshness. full_bar = canonical OHLCV row, close_only = close fallback with synthetic OHLCV.';
