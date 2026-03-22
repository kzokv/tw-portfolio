#!/usr/bin/env bash
set -euo pipefail

# Runs inside the newly created worktree directory (cwd is already set).
# Available env vars:
#   MAIN_ROOT      – absolute path to the main repo checkout

echo "→ Setting up environment files from main repo..."
npx tsx scripts/env-setup.ts --target root:local,docker:local --non-interactive --source "$MAIN_ROOT"

echo "→ Installing dependencies…"
npm ci

echo "→ Building…"
npm run build

echo "✓ Worktree ready."
