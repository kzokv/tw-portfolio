#!/usr/bin/env bash
# Help-printer for dev / e2e / test commands.
# Usage: help.sh [dev|e2e|test]

set -euo pipefail

section="${1:-dev}"

case "$section" in
  dev)
    cat <<'EOF'
Available dev commands:

  dev:local:bypass:mem       Fastest iteration — no auth, in-memory
  dev:local:bypass:pg        Bypass auth, real Postgres
  dev:local:oauth:mem        Google OAuth, in-memory
  dev:local:oauth:pg         Google OAuth, Postgres (closest to prod)
  dev:docker                 Docker Compose local stack (oauth + postgres)
  dev:docker --migrate       Docker Compose + run DB migrations
  dev:docker:cleanup         Clean up Docker images/containers
  dev:docker:cleanup:dry     Dry run cleanup
  dev:docker:cleanup:force   Auto-confirm cleanup
  dev:docker:validate        Validate local compose config
  dev:docker:validate:teardown  Validate then tear down

Run: npm run <command>
EOF
    ;;
  e2e)
    cat <<'EOF'
Available test:e2e commands:

  test:e2e:bypass:mem        dev_bypass E2E suite, in-memory
  test:e2e:oauth:mem         OAuth E2E suite, in-memory
  test:e2e:ci:bypass:mem     CI variant (GitHub Actions)
  test:e2e:show-report       Open Playwright HTML report

Run: npm run <command>
EOF
    ;;
  test)
    cat <<'EOF'
Available test commands:

  Local:
    test:all                       Unit + integration + E2E bypass
    test:all:full                  Unit + full integration (managed DB) + E2E bypass + OAuth
    test:unit                      Unit tests (all workspaces)
    test:integration               Integration tests (no DB migrations)
    test:integration:full:host     Full integration with managed DB (local)
    test:integration:full:container  Full integration (from inside container)
    test:e2e:bypass:mem            E2E dev_bypass suite
    test:e2e:oauth:mem             E2E OAuth suite (requires refresh token)

  Flags for test.sh:
    --all                          Run unit + integration + e2e:bypass
    --full                         Upgrade integration to include DB migrations
    --e2e-oauth                    Include OAuth E2E suite

Run: npm run <command>  or  bash scripts/test.sh <flags>
EOF
    ;;
  *)
    echo "Unknown help section: $section" >&2
    echo "Usage: help.sh [dev|e2e|test]" >&2
    exit 1
    ;;
esac
