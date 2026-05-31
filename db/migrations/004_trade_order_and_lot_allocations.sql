ALTER TABLE trade_events
  ADD COLUMN IF NOT EXISTS trade_timestamp TIMESTAMP,
  ADD COLUMN IF NOT EXISTS booking_sequence INTEGER;

UPDATE trade_events
SET trade_timestamp = COALESCE(trade_timestamp, booked_at, trade_date::timestamp)
WHERE trade_timestamp IS NULL;

WITH sequenced_trade_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id, trade_date
      ORDER BY COALESCE(trade_timestamp, booked_at, trade_date::timestamp), booked_at, id
    ) AS next_booking_sequence
  FROM trade_events
)
UPDATE trade_events AS trade_event
SET booking_sequence = sequenced_trade_events.next_booking_sequence
FROM sequenced_trade_events
WHERE trade_event.id = sequenced_trade_events.id
  AND trade_event.booking_sequence IS NULL;

ALTER TABLE trade_events
  ALTER COLUMN trade_timestamp SET NOT NULL,
  ALTER COLUMN booking_sequence SET NOT NULL;

ALTER TABLE trade_events
  DROP CONSTRAINT IF EXISTS trade_events_booking_sequence_positive,
  ADD CONSTRAINT trade_events_booking_sequence_positive CHECK (booking_sequence > 0);

CREATE INDEX IF NOT EXISTS idx_trade_events_account_symbol_booking_order
  ON trade_events(account_id, symbol, trade_date, booking_sequence, trade_timestamp, id);

ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS opened_sequence INTEGER;

WITH sequenced_lots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY account_id, symbol, opened_at
      ORDER BY opened_at, id
    ) AS next_opened_sequence
  FROM lots
)
UPDATE lots AS lot
SET opened_sequence = sequenced_lots.next_opened_sequence
FROM sequenced_lots
WHERE lot.id = sequenced_lots.id
  AND lot.opened_sequence IS NULL;

ALTER TABLE lots
  ALTER COLUMN opened_sequence SET NOT NULL;

ALTER TABLE lots
  DROP CONSTRAINT IF EXISTS lots_opened_sequence_positive,
  ADD CONSTRAINT lots_opened_sequence_positive CHECK (opened_sequence > 0);

CREATE INDEX IF NOT EXISTS idx_lots_account_symbol_opened_order
  ON lots(account_id, symbol, opened_at, opened_sequence, id);

CREATE TABLE IF NOT EXISTS lot_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  trade_event_id TEXT NOT NULL REFERENCES trade_events(id),
  symbol TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  lot_opened_at DATE NOT NULL,
  lot_opened_sequence INTEGER NOT NULL CHECK (lot_opened_sequence > 0),
  allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity > 0),
  allocated_cost_ntd INTEGER NOT NULL CHECK (allocated_cost_ntd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lot_allocations_trade_event_id
  ON lot_allocations(trade_event_id);
CREATE INDEX IF NOT EXISTS idx_lot_allocations_account_symbol
  ON lot_allocations(account_id, symbol, lot_opened_at, lot_opened_sequence, lot_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lot_allocations_trade_event_lot
  ON lot_allocations(trade_event_id, lot_id);
