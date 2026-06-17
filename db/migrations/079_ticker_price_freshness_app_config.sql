ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS ticker_price_close_refresh_grace_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_intraday_enabled BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_intraday_refresh_interval_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_intraday_freshness_tolerance_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_yahoo_chart_request_limit_per_minute INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_queue_concurrency INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_max_tickers_per_refresh_cycle INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_supported_markets TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_regular_session_only BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_yahoo_chart_range TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_yahoo_chart_interval TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_refresh_close_rate_limit_window_ms BIGINT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_refresh_close_rate_limit_max INT NULL,
  ADD COLUMN IF NOT EXISTS ticker_price_sync_ticker_cap INT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_config_ticker_price_supported_markets_check'
      AND conrelid = 'public.app_config'::regclass
  ) THEN
    ALTER TABLE public.app_config
      ADD CONSTRAINT app_config_ticker_price_supported_markets_check
      CHECK (
        ticker_price_supported_markets IS NULL
        OR ticker_price_supported_markets <@ ARRAY['TW', 'US', 'AU', 'KR']::text[]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_config_ticker_price_yahoo_chart_range_check'
      AND conrelid = 'public.app_config'::regclass
  ) THEN
    ALTER TABLE public.app_config
      ADD CONSTRAINT app_config_ticker_price_yahoo_chart_range_check
      CHECK (
        ticker_price_yahoo_chart_range IS NULL
        OR ticker_price_yahoo_chart_range IN ('1d', '5d')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_config_ticker_price_yahoo_chart_interval_check'
      AND conrelid = 'public.app_config'::regclass
  ) THEN
    ALTER TABLE public.app_config
      ADD CONSTRAINT app_config_ticker_price_yahoo_chart_interval_check
      CHECK (
        ticker_price_yahoo_chart_interval IS NULL
        OR ticker_price_yahoo_chart_interval IN ('1m', '2m', '5m', '15m')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.app_config.ticker_price_close_refresh_grace_minutes IS
  'Ticker price freshness: minutes after regular close before manual/worker close refresh becomes eligible. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_intraday_enabled IS
  'Ticker price freshness: enables intraday overlay queueing and worker refresh. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_intraday_refresh_interval_minutes IS
  'Ticker price freshness: target intraday refresh cadence in minutes. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_intraday_freshness_tolerance_minutes IS
  'Ticker price freshness: same-day intraday bar freshness tolerance in minutes. NULL = derived default.';
COMMENT ON COLUMN public.app_config.ticker_price_yahoo_chart_request_limit_per_minute IS
  'Ticker price freshness: queue-level Yahoo chart request budget per minute for intraday refresh workers. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_queue_concurrency IS
  'Ticker price freshness: pg-boss intraday worker concurrency. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_max_tickers_per_refresh_cycle IS
  'Ticker price freshness: max stale/missing ticker-market pairs enqueued per demand-trigger refresh cycle. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_supported_markets IS
  'Ticker price freshness: supported markets for intraday overlay and close refresh. NULL = all scoped MVP markets.';
COMMENT ON COLUMN public.app_config.ticker_price_regular_session_only IS
  'Ticker price freshness: restricts intraday refresh to regular cash sessions only. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_yahoo_chart_range IS
  'Ticker price freshness: Yahoo chart range override for intraday fetches. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_yahoo_chart_interval IS
  'Ticker price freshness: Yahoo chart interval override for intraday fetches. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_refresh_close_rate_limit_window_ms IS
  'Ticker price freshness: rate-limit window in ms for manual refresh-closes requests. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_refresh_close_rate_limit_max IS
  'Ticker price freshness: max manual refresh-closes requests per rate-limit window. NULL = use grouped resolver default.';
COMMENT ON COLUMN public.app_config.ticker_price_sync_ticker_cap IS
  'Ticker price freshness: synchronous ticker cap before refresh-closes must queue remaining work. NULL = use grouped resolver default.';
