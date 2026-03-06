#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${0##*/}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

print_help() {
  cat <<EOF
Description:
  Run managed Postgres/Redis integration CI tests from a Linux/containerized shell using
  host.docker.internal host-gateway mapping.

Usage: ${SCRIPT_PATH} [OPTIONS]

Options:
  -h, --help              Show this help message and exit (optional)
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  print_help
  exit 0
fi

if [ "$#" -gt 0 ]; then
  echo "ERROR: Unexpected arguments: $*" >&2
  print_help >&2
  exit 2
fi

# shellcheck source=./test-integration-ci-lib.sh
source "${SCRIPT_DIR}/test-integration-ci-lib.sh"
run_integration_ci_mode "container"
