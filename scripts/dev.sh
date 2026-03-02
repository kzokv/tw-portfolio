#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

set -a
[ -f ./.env ] && . ./.env
set +a

api_pid=""
web_pid=""

cleanup() {
  local exit_code=$?

  for pid in "$web_pid" "$api_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done

  wait "$web_pid" "$api_pid" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

setsid npm run dev -w apps/api &
api_pid=$!

setsid npm run dev -w apps/web &
web_pid=$!

wait -n "$api_pid" "$web_pid"
