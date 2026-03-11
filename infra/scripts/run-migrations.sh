#!/bin/sh
set -e

applied=0
file_count=0
tmp_script=""

log() { echo "[$(date '+%H:%M:%S')] [migrate] $*"; }

cleanup() {
  if [ -n "$tmp_script" ] && [ -f "$tmp_script" ]; then
    rm -f "$tmp_script"
  fi
}

on_exit() {
  rc=$?
  cleanup
  if [ "$rc" -ne 0 ]; then
    log "FAILED after $applied of $file_count migration(s) (exit code $rc)"
  fi
}
trap on_exit EXIT

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

is_applied() {
  [ -n "$applied_names" ] && printf '%s\n' "$applied_names" | grep -Fxq "$1"
}

is_baseline_superseded() {
  [ -n "${BASELINE_SUPERSEDES:-}" ] || return 1
  case ",${BASELINE_SUPERSEDES}," in
    *,"$1",*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ! -d /migrations ]; then
  log "ERROR: /migrations directory not found"
  exit 1
fi

if [ -f /migrations/manifest.env ]; then
  # shellcheck disable=SC1091
  . /migrations/manifest.env
fi

sql_files="$(find /migrations -maxdepth 1 -name '[0-9][0-9][0-9]_*.sql' -type f | sort)"

if [ -n "${BASELINE_MIGRATION:-}" ] && [ ! -f "/migrations/${BASELINE_MIGRATION}" ]; then
  log "ERROR: baseline migration /migrations/${BASELINE_MIGRATION} not found"
  exit 1
fi

log "Target: ${PGUSER:-?}@${PGHOST:-?}/${PGDATABASE:-?}"

psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

applied_names="$(psql -v ON_ERROR_STOP=1 -Atqc 'SELECT name FROM schema_migrations ORDER BY name')"
public_table_count="$(psql -v ON_ERROR_STOP=1 -Atqc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'")"
use_baseline=0

if [ -n "${BASELINE_MIGRATION:-}" ] && [ -z "$applied_names" ] && [ "$public_table_count" = "0" ]; then
  use_baseline=1
  file_count=$((file_count + 1))
  log "Fresh database detected; bootstrapping from ${BASELINE_MIGRATION}"
elif [ -n "${BASELINE_MIGRATION:-}" ] && [ -z "$applied_names" ] && [ "$public_table_count" != "0" ]; then
  log "ERROR: public schema contains tables but schema_migrations is empty; refusing ambiguous replay"
  exit 1
fi

tmp_script="$(mktemp)"

{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT pg_advisory_xact_lock(hashtext('tw_portfolio_schema_migrations'));
SQL

  if [ "$use_baseline" -eq 1 ]; then
    printf '%s\n' "\\echo Applying ${BASELINE_MIGRATION}"
    printf '%s\n' "\\i /migrations/${BASELINE_MIGRATION}"
    printf "INSERT INTO schema_migrations (name) VALUES ('%s') ON CONFLICT (name) DO NOTHING;\n" "$(sql_escape "$BASELINE_MIGRATION")"

    if [ -n "${BASELINE_SUPERSEDES:-}" ]; then
      old_ifs=$IFS
      IFS=','
      set -- $BASELINE_SUPERSEDES
      IFS=$old_ifs
      for migration_name in "$@"; do
        trimmed_name="$(printf '%s' "$migration_name" | xargs)"
        [ -n "$trimmed_name" ] || continue
        printf "INSERT INTO schema_migrations (name) VALUES ('%s') ON CONFLICT (name) DO NOTHING;\n" "$(sql_escape "$trimmed_name")"
      done
    fi
  fi

  for f in $sql_files; do
    base_name="$(basename "$f")"
    if is_applied "$base_name"; then
      continue
    fi
    if [ "$use_baseline" -eq 1 ] && is_baseline_superseded "$base_name"; then
      continue
    fi

    printf '%s\n' "\\echo Applying ${base_name}"
    printf '%s\n' "\\i ${f}"
    printf "INSERT INTO schema_migrations (name) VALUES ('%s') ON CONFLICT (name) DO NOTHING;\n" "$(sql_escape "$base_name")"
    file_count=$((file_count + 1))
  done

  echo 'COMMIT;'
} >"$tmp_script"

if [ "$file_count" -eq 0 ]; then
  log "No pending migrations"
  exit 0
fi

log "Applying $file_count migration step(s)"
psql -v ON_ERROR_STOP=1 -f "$tmp_script"
applied="$file_count"

log "All $applied migration(s) applied successfully"
