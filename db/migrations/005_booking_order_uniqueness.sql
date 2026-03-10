WITH duplicate_trade_days AS (
  SELECT account_id, trade_date
  FROM trade_events
  GROUP BY account_id, trade_date
  HAVING COUNT(*) <> COUNT(DISTINCT booking_sequence)
),
normalized_trade_events AS (
  SELECT
    trade_event.id,
    ROW_NUMBER() OVER (
      PARTITION BY trade_event.account_id, trade_event.trade_date
      ORDER BY
        COALESCE(trade_event.booking_sequence, 2147483647),
        COALESCE(trade_event.trade_timestamp, trade_event.booked_at, trade_event.trade_date::timestamp),
        trade_event.booked_at,
        trade_event.id
    ) AS next_booking_sequence
  FROM trade_events AS trade_event
  INNER JOIN duplicate_trade_days AS duplicate_day
    ON duplicate_day.account_id = trade_event.account_id
   AND duplicate_day.trade_date = trade_event.trade_date
)
UPDATE trade_events AS trade_event
SET booking_sequence = normalized_trade_events.next_booking_sequence
FROM normalized_trade_events
WHERE trade_event.id = normalized_trade_events.id
  AND trade_event.booking_sequence IS DISTINCT FROM normalized_trade_events.next_booking_sequence;

CREATE UNIQUE INDEX IF NOT EXISTS ux_trade_events_account_trade_date_booking_sequence
  ON trade_events(account_id, trade_date, booking_sequence);

WITH duplicate_lot_openings AS (
  SELECT account_id, symbol, opened_at
  FROM lots
  GROUP BY account_id, symbol, opened_at
  HAVING COUNT(*) <> COUNT(DISTINCT opened_sequence)
),
normalized_lots AS (
  SELECT
    lot.id,
    ROW_NUMBER() OVER (
      PARTITION BY lot.account_id, lot.symbol, lot.opened_at
      ORDER BY
        COALESCE(lot.opened_sequence, 2147483647),
        lot.id
    ) AS next_opened_sequence
  FROM lots AS lot
  INNER JOIN duplicate_lot_openings AS duplicate_opening
    ON duplicate_opening.account_id = lot.account_id
   AND duplicate_opening.symbol = lot.symbol
   AND duplicate_opening.opened_at = lot.opened_at
)
UPDATE lots AS lot
SET opened_sequence = normalized_lots.next_opened_sequence
FROM normalized_lots
WHERE lot.id = normalized_lots.id
  AND lot.opened_sequence IS DISTINCT FROM normalized_lots.next_opened_sequence;

CREATE UNIQUE INDEX IF NOT EXISTS ux_lots_account_symbol_opened_order
  ON lots(account_id, symbol, opened_at, opened_sequence);
