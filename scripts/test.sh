#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

UNIT=0; INTEGRATION=0; E2E=0; E2E_OAUTH=0; HTTP_API=0; FULL=0

if [[ $# -eq 0 ]]; then
  bash scripts/help.sh test
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) UNIT=1; INTEGRATION=1; E2E=1 ;;
    --unit) UNIT=1 ;;
    --integration) INTEGRATION=1 ;;
    --e2e) E2E=1 ;;
    --e2e-oauth) E2E_OAUTH=1 ;;
    --http-api) HTTP_API=1 ;;
    --full) FULL=1 ;;
    -h|--help) bash scripts/help.sh test; exit 0 ;;
    *) echo "ERROR: Unknown flag: $1" >&2; bash scripts/help.sh test; exit 1 ;;
  esac
  shift
done

if [[ $UNIT -eq 1 ]]; then
  echo "── Running unit tests ──"
  if [[ $FULL -eq 1 ]]; then
    # Full integration runs separately with managed DB — skip API integration
    # tests here to avoid running them twice.
    npm run test -w @tw-portfolio/web -w @tw-portfolio/config -w @tw-portfolio/domain
    npm run test -w @tw-portfolio/api -- --exclude '**/integration/**'
  else
    npm run test --workspaces
  fi
fi

if [[ $INTEGRATION -eq 1 ]]; then
  if [[ $FULL -eq 1 ]]; then
    echo "── Running full integration tests (managed DB) ──"
    npm run test:integration:full:host
  else
    echo "── Running integration tests ──"
    npm run test:integration
  fi
fi

# Sweep orphan Node processes left from integration tests before E2E phase.
# Any port:0 Fastify server that survived a test timeout/crash is killed here.
if [[ $INTEGRATION -eq 1 ]] && ( [[ $E2E -eq 1 ]] || [[ $E2E_OAUTH -eq 1 ]] ); then
  echo "── Sweeping orphan Node processes between phases ──"
  pkill -f "${ROOT_DIR}/apps/api/src" 2>/dev/null || true
  sleep 1
fi

if [[ $E2E -eq 1 ]]; then
  echo "── Running E2E tests (bypass) ──"
  npm run test:e2e:bypass:mem
fi

if [[ $E2E_OAUTH -eq 1 ]]; then
  echo "── Running E2E tests (OAuth) ──"
  npm run test:e2e:oauth:mem
fi

if [[ $HTTP_API -eq 1 ]]; then
  echo "── Running API HTTP tests ──"
  npm run test:http:api
fi
