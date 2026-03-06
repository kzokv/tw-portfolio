#!/usr/bin/env bash
set -euo pipefail

  cat >&2 <<'EOF'
ERROR: scripts/test-integration-ci.sh is retired.

Use one of the explicit modes instead:
  npm run test:integration:ci:host
  npm run test:integration:ci:container
EOF

  exit 1
