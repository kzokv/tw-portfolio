#!/usr/bin/env bash
set -euo pipefail

# Runs inside the newly created worktree directory (cwd is already set).
# Available env vars:
#   MAIN_ROOT      – absolute path to the main repo checkout

echo "→ Installing dependencies…"
npm ci

echo "→ Setting up environment files from main repo..."
npx tsx scripts/env-setup.ts --target root:local,docker:local --non-interactive --source "$MAIN_ROOT"

echo "→ Building…"
npm run build

echo "✓ Worktree ready."

if [ -t 0 ]; then
  echo ""
  echo "→ To run OAuth E2E tests, you need a Google refresh token."
  read -t 10 -rp "→ Run auth:refresh-token now? [Y/n] " ans || {
    echo ""
    echo "⚠ Timed out — skipping auth:refresh-token."
    echo "  Run manually later: npm run auth:refresh-token"
    ans="n"
  }
  if [[ "${ans:-Y}" =~ ^[Yy] ]]; then
    npm run auth:refresh-token
  fi
else
  echo "→ Non-interactive mode: skipping auth:refresh-token."
  echo "  Run manually if needed: npm run auth:refresh-token"
fi
