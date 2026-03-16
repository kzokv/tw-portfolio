#!/usr/bin/env bash
set -euo pipefail

# Runs inside the newly created worktree directory (cwd is already set).
# Available env vars:
#   MAIN_ROOT      – absolute path to the main repo checkout

echo "→ Copying .env from main repo…"
cp "$MAIN_ROOT/.env" .env

echo "→ Installing dependencies…"
npm ci

echo "→ Building…"
npm run build

echo "✓ Worktree ready."