# Postgres DATE Normalization

## Context

The API persists some business dates into Postgres `DATE` columns while application code may still carry full JavaScript `Date` timestamps.

On non-UTC hosts, deriving a calendar date with `toISOString().slice(0, 10)` can shift the stored day backward or forward relative to local business meaning.

## Durable Takeaway

- when a value represents a business calendar date for a Postgres `DATE` column, normalize it with local calendar components rather than UTC ISO slicing
- reserve full ISO timestamps for `TIMESTAMP` semantics such as `bookedAt`

## Practical Rule

Prefer helpers that derive:

- `year = value.getFullYear()`
- `month = value.getMonth() + 1`
- `day = value.getDate()`

Then format `YYYY-MM-DD` from those local components.

Avoid:

- `toISOString().slice(0, 10)` for business-date persistence

## Why It Matters Here

This repository books trades, dividends, and snapshots against business dates that must stay stable across host timezones. Off-by-one-day drift is expensive to debug and can silently corrupt accounting meaning.
