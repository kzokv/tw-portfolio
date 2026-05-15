#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"

ENVIRONMENT="${ENVIRONMENT:-production}"
ENV_FILE="${ENV_FILE:-}"
POSTGRES_CONTAINER=""

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
RETAIN_DAYS="${RETAIN_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/${PG_DB}_${TIMESTAMP}.sql.gz"

if ! mkdir -p "$BACKUP_DIR"; then
  echo "ERROR: Cannot create BACKUP_DIR at '$BACKUP_DIR'" >&2
  echo "Set BACKUP_DIR or VAKWEN_STATE_DIR to a writable path." >&2
  exit 1
fi

echo "==> Backing up ${ENVIRONMENT} database ${PG_DB} to $DUMP_FILE"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$DUMP_FILE"

echo "==> Pruning backups older than ${RETAIN_DAYS} days..."
find "$BACKUP_DIR" -name "${PG_DB}_*.sql.gz" -mtime "+${RETAIN_DAYS}" -delete

echo "==> Backup complete: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
