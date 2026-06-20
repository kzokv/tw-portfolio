#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"

ENVIRONMENT="${ENVIRONMENT:-production}"
ENV_FILE="${ENV_FILE:-}"
POSTGRES_CONTAINER=""
TMP_DUMP_FILE=""

print_help() {
  cat <<EOF
Description:
  Back up the PostgreSQL database for the selected vakwen deployment environment.

Usage: ${SCRIPT_PATH} [OPTIONS]

Options:
  -h, --help                   Show this help message and exit (optional)
  -e, --environment ENV        Backup environment: production or dev (optional, default: production)
EOF
}

error_and_help() {
  echo "ERROR: $1" >&2
  echo >&2
  print_help >&2
  exit 1
}

cleanup_tmp_dump() {
  if [ -n "${TMP_DUMP_FILE:-}" ] && [ -f "$TMP_DUMP_FILE" ]; then
    rm -f "$TMP_DUMP_FILE"
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help)
        print_help
        exit 0
        ;;
      -e|--environment)
        if [ "${2-}" = "" ] || [[ "$2" == -* ]]; then
          error_and_help "--environment requires a value"
        fi
        ENVIRONMENT="$2"
        shift 2
        ;;
      --environment=*)
        ENVIRONMENT="${1#*=}"
        if [ -z "$ENVIRONMENT" ]; then
          error_and_help "--environment requires a value"
        fi
        shift 1
        ;;
      *)
        error_and_help "Unexpected argument: $1"
        ;;
    esac
  done
}

configure_environment() {
  case "$ENVIRONMENT" in
    production)
      POSTGRES_CONTAINER="vakwen-prod-postgres"
      ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../docker/.env.prod}"
      ;;
    dev)
      POSTGRES_CONTAINER="vakwen-dev-postgres"
      ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../docker/.env.dev}"
      ;;
    *)
      error_and_help "Unsupported environment: $ENVIRONMENT"
      ;;
  esac
}

default_retention_days() {
  case "$ENVIRONMENT" in
    production) echo "30" ;;
    dev) echo "7" ;;
    *) error_and_help "Unsupported environment for retention defaults: $ENVIRONMENT" ;;
  esac
}

default_retention_max_files() {
  case "$ENVIRONMENT" in
    production) echo "60" ;;
    dev) echo "20" ;;
    *) error_and_help "Unsupported environment for retention defaults: $ENVIRONMENT" ;;
  esac
}

configure_retention() {
  local default_days default_max_files

  default_days="$(default_retention_days)"
  default_max_files="$(default_retention_max_files)"

  BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-${RETAIN_DAYS:-$default_days}}"
  BACKUP_RETAIN_MAX_FILES="${BACKUP_RETAIN_MAX_FILES:-$default_max_files}"
}

prune_backups_older_than_days() {
  local retain_days="$1"

  if ! [[ "$retain_days" =~ ^[0-9]+$ ]]; then
    echo "ERROR: BACKUP_RETAIN_DAYS must be a non-negative integer (got '$retain_days')" >&2
    exit 1
  fi

  echo "==> Pruning backups older than ${retain_days} days..."
  find "$BACKUP_DIR" -maxdepth 1 -name "${PG_DB}_*.sql.gz" -mtime "+${retain_days}" -delete
}

prune_backup_file_count() {
  local keep_count="$1"
  local backups_to_remove=""

  if ! [[ "$keep_count" =~ ^[0-9]+$ ]] || [ "$keep_count" -lt 1 ]; then
    echo "ERROR: BACKUP_RETAIN_MAX_FILES must be a positive integer (got '$keep_count')" >&2
    exit 1
  fi

  backups_to_remove="$(
    find "$BACKUP_DIR" -maxdepth 1 -name "${PG_DB}_*.sql.gz" -print \
      | LC_ALL=C sort -r \
      | awk -v keep="$keep_count" 'NR > keep { print }'
  )"

  if [ -z "$backups_to_remove" ]; then
    echo "==> Backup file-count retention: keeping all files (max ${keep_count})"
    return 0
  fi

  echo "==> Pruning backup files beyond newest ${keep_count}..."
  while IFS= read -r backup_file; do
    [ -z "$backup_file" ] && continue
    rm -f "$backup_file"
  done <<EOF
$backups_to_remove
EOF
}

prune_backups_after_success() {
  prune_backups_older_than_days "$BACKUP_RETAIN_DAYS"
  prune_backup_file_count "$BACKUP_RETAIN_MAX_FILES"
}

parse_args "$@"
configure_environment

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PG_USER="${POSTGRES_USER:-vakwen}"
PG_DB="${POSTGRES_DB:-vakwen}"
DEFAULT_HOME="${HOME:-$SCRIPT_DIR/../..}"
STATE_BASE_DIR="${VAKWEN_STATE_DIR:-$DEFAULT_HOME/.local/state/vakwen/$ENVIRONMENT}"
BACKUP_DIR="${BACKUP_DIR:-$STATE_BASE_DIR/backups}"
configure_retention
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/${PG_DB}_${TIMESTAMP}.sql.gz"

trap cleanup_tmp_dump EXIT

if ! mkdir -p "$BACKUP_DIR"; then
  echo "ERROR: Cannot create BACKUP_DIR at '$BACKUP_DIR'" >&2
  echo "Set BACKUP_DIR or VAKWEN_STATE_DIR to a writable path." >&2
  exit 1
fi

TMP_DUMP_FILE="$(mktemp "$BACKUP_DIR/.${PG_DB}_${TIMESTAMP}.XXXXXX.sql.gz.tmp")"

echo "==> Backing up ${ENVIRONMENT} database ${PG_DB} to $DUMP_FILE"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$TMP_DUMP_FILE"
mv "$TMP_DUMP_FILE" "$DUMP_FILE"
TMP_DUMP_FILE=""

prune_backups_after_success

echo "==> Backup complete: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
