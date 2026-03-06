#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="infra/docker/docker-compose.ci-integration.yml"
COMPOSE_PROJECT="${CI_COMPOSE_PROJECT:-twp-ci-integration}"
CI_DB_PORT="${CI_DB_PORT:-15432}"
CI_REDIS_PORT="${CI_REDIS_PORT:-16379}"
CI_DB_NAME="${CI_DB_NAME:-tw_portfolio_ci}"
KEEP_CI_STACK="${KEEP_CI_STACK:-0}"

INTEGRATION_CI_MODE=""
TEST_HOST=""
COMPOSE_BIN=()

log_ci() {
  echo "[test:integration:ci:${INTEGRATION_CI_MODE}] $*"
}

compose() {
  "${COMPOSE_BIN[@]}" --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  if [ "$KEEP_CI_STACK" = "1" ]; then
    log_ci "KEEP_CI_STACK=1; leaving CI stack running."
    return
  fi

  log_ci "Stopping CI stack..."
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}

require_docker_cli() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not available on PATH." >&2
    exit 1
  fi
}

require_node_cli() {
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is not available on PATH (required for host/dns probes)." >&2
    exit 1
  fi
}

require_docker_daemon() {
  if ! docker info >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: Docker daemon is not reachable.
Ensure your Docker daemon is running and this shell can access the configured Docker endpoint.
EOF
    exit 1
  fi
}

require_docker_credentials_helper() {
  local docker_config_dir docker_config_file creds_store helper_name
  docker_config_dir="${DOCKER_CONFIG:-$HOME/.docker}"
  docker_config_file="${docker_config_dir}/config.json"

  if [ ! -f "$docker_config_file" ]; then
    return
  fi

  creds_store="$(
    DOCKER_CONFIG_FILE="$docker_config_file" node -e '
const fs = require("node:fs");
const configPath = process.env.DOCKER_CONFIG_FILE;
try {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof parsed.credsStore === "string" && parsed.credsStore.trim() !== "") {
    process.stdout.write(parsed.credsStore.trim());
  }
} catch {}
' 2>/dev/null || true
  )"

  if [ -z "$creds_store" ]; then
    return
  fi

  helper_name="docker-credential-${creds_store}"
  if command -v "$helper_name" >/dev/null 2>&1; then
    return
  fi

  cat >&2 <<EOF
ERROR: Docker credential helper '$helper_name' is required by:
  $docker_config_file
but it is not available on PATH.

Fix options:
  1) Install/provide '$helper_name' in PATH
  2) Remove or change 'credsStore' in Docker config for this environment
  3) Use a VM-specific DOCKER_CONFIG without 'credsStore'
EOF
  exit 1
}

detect_compose_bin() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
  else
    echo "ERROR: neither 'docker compose' nor 'docker-compose' is available on PATH." >&2
    exit 1
  fi
}

wait_for_postgres() {
  local attempts=60
  local i
  for ((i=1; i<=attempts; i++)); do
    if compose exec -T postgres-ci pg_isready -U app -d "$CI_DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: postgres-ci did not become ready in ${attempts}s." >&2
  compose logs --tail=120 postgres-ci >&2 || true
  return 1
}

wait_for_redis() {
  local attempts=60
  local i
  for ((i=1; i<=attempts; i++)); do
    if [ "$(compose exec -T redis-ci redis-cli ping 2>/dev/null || true)" = "PONG" ]; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: redis-ci did not become ready in ${attempts}s." >&2
  compose logs --tail=120 redis-ci >&2 || true
  return 1
}

probe_tcp_host_port() {
  local host="$1"
  local port="$2"
  local timeout_ms="${3:-1500}"

  node -e '
const net = require("node:net");
const host = process.argv[1];
const port = Number(process.argv[2]);
const timeoutMs = Number(process.argv[3]);
const socket = net.createConnection({ host, port });
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  try { socket.destroy(); } catch {}
  process.exit(code);
};
socket.setTimeout(timeoutMs);
socket.on("connect", () => finish(0));
socket.on("timeout", () => finish(1));
socket.on("error", () => finish(1));
' "$host" "$port" "$timeout_ms" >/dev/null 2>&1
}

host_reachable_on_ci_ports() {
  local host="$1"
  probe_tcp_host_port "$host" "$CI_DB_PORT" && probe_tcp_host_port "$host" "$CI_REDIS_PORT"
}

wait_for_host_ports() {
  local host="$1"
  local attempts="${CI_HOST_PORT_PROBE_ATTEMPTS:-30}"
  local sleep_seconds="${CI_HOST_PORT_PROBE_INTERVAL_SECONDS:-1}"
  local i

  # Container-level readiness can become true slightly before host-published
  # port forwarding is reachable (observed on Linux VM/containerized setups).
  # Polling here avoids false negatives from a one-shot probe.
  for ((i=1; i<=attempts; i++)); do
    if host_reachable_on_ci_ports "$host"; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  return 1
}

resolve_host_from_docker_host() {
  if [ -z "${DOCKER_HOST:-}" ]; then
    return
  fi

  DOCKER_HOST="$DOCKER_HOST" node -e '
const raw = process.env.DOCKER_HOST || "";
try {
  const value = new URL(raw);
  if (value.protocol === "tcp:") {
    process.stdout.write(value.hostname || "");
  }
} catch {}
' 2>/dev/null || true
}

resolve_default_gateway_host() {
  local os_name
  os_name="$(uname -s)"

  if [ "$os_name" = "Darwin" ] && command -v route >/dev/null 2>&1; then
    route -n get default 2>/dev/null | awk '/gateway:/{print $2; exit}'
    return
  fi

  if [ "$os_name" = "Linux" ]; then
    if command -v ip >/dev/null 2>&1; then
      ip route show default 2>/dev/null | awk '/default/{print $3; exit}'
      return
    fi
    if command -v route >/dev/null 2>&1; then
      route -n 2>/dev/null | awk '$1 == "0.0.0.0" {print $2; exit}'
      return
    fi
  fi
}

append_candidate_host() {
  local candidate="$1"
  local existing
  if [ -z "$candidate" ]; then
    return
  fi

  for existing in "${HOST_CANDIDATES[@]:-}"; do
    if [ "$existing" = "$candidate" ]; then
      return
    fi
  done
  HOST_CANDIDATES+=("$candidate")
}

resolve_host_mode_target() {
  local docker_host_candidate
  local gateway_candidate
  local candidate
  local candidates_display

  if [ -n "${CI_TEST_HOST:-}" ]; then
    if host_reachable_on_ci_ports "$CI_TEST_HOST"; then
      echo "$CI_TEST_HOST"
      return
    fi
    cat >&2 <<EOF
ERROR: CI_TEST_HOST='$CI_TEST_HOST' is not reachable on ports ${CI_DB_PORT} and ${CI_REDIS_PORT}.
Ensure it points to the machine where Docker published the CI Postgres/Redis ports.
EOF
    exit 1
  fi

  HOST_CANDIDATES=()
  docker_host_candidate="$(resolve_host_from_docker_host || true)"
  append_candidate_host "$docker_host_candidate"

  gateway_candidate="$(resolve_default_gateway_host || true)"
  append_candidate_host "$gateway_candidate"

  append_candidate_host "localhost"

  for candidate in "${HOST_CANDIDATES[@]:-}"; do
    if host_reachable_on_ci_ports "$candidate"; then
      echo "$candidate"
      return
    fi
  done

  candidates_display="<none>"
  if [ "${#HOST_CANDIDATES[@]}" -gt 0 ]; then
    candidates_display="$(printf '%s ' "${HOST_CANDIDATES[@]}")"
    candidates_display="${candidates_display% }"
  fi

  cat >&2 <<EOF
ERROR: Could not auto-detect a reachable test host for CI DB/Redis ports.
Tried candidates: ${candidates_display}

Set CI_TEST_HOST explicitly to the Docker-host machine address, for example:
  CI_TEST_HOST=<host-ip-or-dns> npm run test:integration:ci:host
EOF
  exit 1
}

require_host_docker_internal_resolves() {
  if node -e '
const dns = require("node:dns");
dns.lookup(process.argv[1], (err) => process.exit(err ? 1 : 0));
' "host.docker.internal" >/dev/null 2>&1; then
    return
  fi

  cat >&2 <<'EOF'
ERROR: host.docker.internal is not resolvable from this container.

For Linux/containerized execution, start this container with host-gateway mapping:
  docker run ... --add-host=host.docker.internal:host-gateway ...

Or in docker compose:
  extra_hosts:
    - "host.docker.internal:host-gateway"
EOF
  exit 1
}

run_integration_ci_mode() {
  INTEGRATION_CI_MODE="${1:-}"
  case "$INTEGRATION_CI_MODE" in
    host|container)
      ;;
    *)
      echo "ERROR: invalid integration CI mode '$INTEGRATION_CI_MODE'." >&2
      exit 2
      ;;
  esac

  cd "$REPO_ROOT"
  require_docker_cli
  require_node_cli
  require_docker_daemon
  require_docker_credentials_helper
  detect_compose_bin

  if [ "$INTEGRATION_CI_MODE" = "container" ]; then
    require_host_docker_internal_resolves
  fi

  trap cleanup EXIT

  log_ci "Starting isolated CI DB stack..."
  CI_DB_PORT="$CI_DB_PORT" CI_REDIS_PORT="$CI_REDIS_PORT" compose up -d

  log_ci "Waiting for postgres-ci..."
  wait_for_postgres
  log_ci "Waiting for redis-ci..."
  wait_for_redis

  if [ "$INTEGRATION_CI_MODE" = "host" ]; then
    TEST_HOST="$(resolve_host_mode_target)"
  else
    TEST_HOST="host.docker.internal"
  fi

  if ! wait_for_host_ports "$TEST_HOST"; then
    cat >&2 <<EOF
ERROR: test host '$TEST_HOST' is not reachable on ports ${CI_DB_PORT} and ${CI_REDIS_PORT}.
EOF
    if [ "$INTEGRATION_CI_MODE" = "container" ]; then
      cat >&2 <<'EOF'
For Linux/containerized execution, ensure host-gateway mapping:
  docker run ... --add-host=host.docker.internal:host-gateway ...
EOF
    fi
    exit 1
  fi

  log_ci "Running integration tests (test host: $TEST_HOST, db: $CI_DB_PORT, redis: $CI_REDIS_PORT)..."
  TWP_MANAGED_CI_STACK=1 \
  RUN_POSTGRES_INTEGRATION=1 \
  POSTGRES_TEST_DB_URL="postgres://app:app@${TEST_HOST}:${CI_DB_PORT}/${CI_DB_NAME}" \
  POSTGRES_TEST_REDIS_URL="redis://${TEST_HOST}:${CI_REDIS_PORT}" \
  npm run test:integration:full -w apps/api
}
