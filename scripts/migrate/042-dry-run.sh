#!/usr/bin/env bash
#
# KZO-183 — migration 042 dry-run inspector.
#
# Reports counts for the three pre-flight CHECK conditions plus the per-
# (account, fee_profile) fan-out cardinality, WITHOUT applying migration 042
# to the database. Intended to be run by the operator against a snapshot of
# the target environment ahead of the actual migration window.
#
# Per `npm-script-wrapping.md`, this script is NOT exposed as an npm script
# (it takes positional/connection arguments). Invoke directly:
#
#   DATABASE_URL="postgres://..." \
#       bash scripts/migrate/042-dry-run.sh
#
#   # or with --env-file shorthand for docker-compose stacks:
#   bash scripts/migrate/042-dry-run.sh --connection postgres://localhost/db
#
# Exits 0 when the snapshot is migration-ready (zero violations).
# Exits 1 when any pre-flight CHECK would fire (printed counts > 0).

set -euo pipefail

CONNECTION_URL="${DATABASE_URL:-${PGURL:-}}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --connection)
      CONNECTION_URL="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '3,17p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${CONNECTION_URL}" ]]; then
  echo "missing DATABASE_URL or --connection <url>" >&2
  exit 2
fi

run_count() {
  local label="$1"
  local query="$2"
  # shellcheck disable=SC2086
  local n
  n="$(psql "${CONNECTION_URL}" -At -c "${query}")"
  printf '%-60s %s\n' "${label}" "${n}"
  echo "${n}"
}

echo "=== KZO-183 migration 042 dry-run report ==="
echo "(connection: redacted)"
echo

echo "── Pre-flight violation counts (must all be 0) ──────────────"

TRADE_MARKET_VIOLATIONS=$(run_count "trade_events with market mismatch:" "$(cat <<'SQL'
SELECT COUNT(*)
FROM trade_events te
JOIN accounts a ON a.id = te.account_id
WHERE
  (a.default_currency = 'TWD' AND te.market_code <> 'TW')
  OR (a.default_currency = 'USD' AND te.market_code <> 'US')
  OR (a.default_currency = 'AUD' AND te.market_code <> 'AU')
  OR a.default_currency NOT IN ('TWD', 'USD', 'AUD');
SQL
)" | tail -1)

DIVIDEND_MARKET_VIOLATIONS=$(run_count "dividend_ledger_entries with market mismatch:" "$(cat <<'SQL'
SELECT COUNT(*)
FROM dividend_ledger_entries dle
JOIN accounts a ON a.id = dle.account_id
JOIN market_data.dividend_events de ON de.id = dle.dividend_event_id
WHERE de.cash_dividend_currency <> a.default_currency;
SQL
)" | tail -1)

OVERRIDE_DUPLICATES=$(run_count "(account_id, ticker) duplicates across markets:" "$(cat <<'SQL'
SELECT COALESCE(SUM(n - 1), 0)
FROM (
  SELECT account_id, ticker, COUNT(*) AS n
  FROM account_fee_profile_overrides
  GROUP BY account_id, ticker
  HAVING COUNT(*) > 1
) AS dupes;
SQL
)" | tail -1)

echo
echo "── Backfill cardinality estimates ───────────────────────────"

TOTAL_PROFILES=$(run_count "fee_profiles total rows (pre-rescope):" \
  "SELECT COUNT(*) FROM fee_profiles;" | tail -1)

PROFILES_FANOUT=$(run_count "fee_profiles after fan-out (estimate):" "$(cat <<'SQL'
WITH profile_users AS (
  SELECT DISTINCT a.fee_profile_id AS old_profile_id, a.id AS account_id FROM accounts a
  UNION
  SELECT DISTINCT o.fee_profile_id AS old_profile_id, o.account_id
  FROM account_fee_profile_overrides o
)
SELECT COUNT(*) FROM (SELECT DISTINCT old_profile_id, account_id FROM profile_users) AS x;
SQL
)" | tail -1)

ORPHAN_PROFILES=$(run_count "fee_profiles with no referencing account (will be deleted):" "$(cat <<'SQL'
SELECT COUNT(*) FROM fee_profiles fp
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.fee_profile_id = fp.id
)
AND NOT EXISTS (
  SELECT 1 FROM account_fee_profile_overrides o WHERE o.fee_profile_id = fp.id
);
SQL
)" | tail -1)

echo
echo "── Summary ──────────────────────────────────────────────────"
echo "Profiles before:           ${TOTAL_PROFILES}"
echo "Profiles after fan-out:    ${PROFILES_FANOUT}"
echo "Profiles dropped (orphan): ${ORPHAN_PROFILES}"

EXIT_CODE=0
if [[ "${TRADE_MARKET_VIOLATIONS}" -ne 0 || "${DIVIDEND_MARKET_VIOLATIONS}" -ne 0 || "${OVERRIDE_DUPLICATES}" -ne 0 ]]; then
  echo
  echo "BLOCKED: pre-flight violations present. Migration 042 will abort."
  EXIT_CODE=1
else
  echo
  echo "READY: no pre-flight violations."
fi

exit "${EXIT_CODE}"
