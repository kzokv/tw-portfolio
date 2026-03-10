CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_account_trade_date_booking_sequence
  ON trade_events(account_id, trade_date, booking_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lots_account_symbol_opened_order
  ON lots(account_id, symbol, opened_at, opened_sequence);
