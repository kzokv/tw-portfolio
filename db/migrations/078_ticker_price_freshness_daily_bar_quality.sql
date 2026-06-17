-- Ticker price freshness: distinguish canonical OHLCV bars from close-only fallbacks.
ALTER TABLE market_data.daily_bars
  ADD COLUMN IF NOT EXISTS quality TEXT;

UPDATE market_data.daily_bars
SET quality = 'full_bar'
WHERE quality IS NULL;

ALTER TABLE market_data.daily_bars
  ALTER COLUMN quality SET DEFAULT 'full_bar',
  ALTER COLUMN quality SET NOT NULL;

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
