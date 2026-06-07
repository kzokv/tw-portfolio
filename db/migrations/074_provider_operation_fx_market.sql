-- Provider operation ledgers can track the synthetic FX workspace. Keep this
-- scoped to operation tables; instrument and mapping tables remain real markets.

ALTER TABLE market_data.provider_operations
  DROP CONSTRAINT IF EXISTS provider_operations_market_code_check;

ALTER TABLE market_data.provider_operations
  ADD CONSTRAINT provider_operations_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'FX'));

ALTER TABLE market_data.provider_operation_outcomes
  DROP CONSTRAINT IF EXISTS provider_operation_outcomes_market_code_check;

ALTER TABLE market_data.provider_operation_outcomes
  ADD CONSTRAINT provider_operation_outcomes_market_code_check
  CHECK (market_code IN ('TW', 'US', 'AU', 'KR', 'FX'));
