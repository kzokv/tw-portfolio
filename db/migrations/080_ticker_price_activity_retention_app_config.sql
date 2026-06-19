ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS ticker_price_activity_detailed_retention_days INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_activity_summary_retention_days INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_calendar_history_retention_days INT NULL;

COMMENT ON COLUMN public.app_config.ticker_price_activity_detailed_retention_days IS
  'Ticker price freshness Activity detailed intraday event retention in days. NULL uses app default.';
COMMENT ON COLUMN public.app_config.ticker_price_activity_summary_retention_days IS
  'Ticker price freshness Activity summary retention in days. NULL uses app default.';
COMMENT ON COLUMN public.app_config.ticker_price_calendar_history_retention_days IS
  'Ticker price freshness calendar import history retention in days. NULL uses app default.';
