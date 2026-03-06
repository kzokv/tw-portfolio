#!/usr/bin/env bash
#
# Onboarding script for tw-portfolio (run from repo root).
#
# What it does:
#   1. Installs npm dependencies (npm ci if lockfile present, else npm install).
#   2. Builds workspace libraries (domain, shared-types).
#   3. Installs Playwright browsers (npx playwright install).
#   4. On Linux (interactive only): installs Playwright system deps; prompts for sudo if needed.
#   5. If .env is missing and .env.example exists, copies .env.example to .env and reminds you to edit.
#   6. Runs a quick sanity check (lint) to verify setup.
#
# Idempotent: safe to run multiple times. Re-running will reinstall deps and Playwright;
# it will not overwrite an existing .env.
#
# Usage:
#   ./scripts/onboard.sh              # Full onboarding
#   ./scripts/onboard.sh --install-only  # Install only (npm + Playwright + deps), then exit
#   ./scripts/onboard.sh --ci          # CI mode: non-interactive, skip .env, run lint
#
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
MIN_NODE_VERSION="24.13.0"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required but was not found in PATH." >&2
  exit 1
fi

version_gte() {
  local current="$1"
  local minimum="$2"
  local c_major=0 c_minor=0 c_patch=0
  local m_major=0 m_minor=0 m_patch=0

  IFS=. read -r c_major c_minor c_patch <<<"$current"
  IFS=. read -r m_major m_minor m_patch <<<"$minimum"

  c_minor="${c_minor:-0}"
  c_patch="${c_patch:-0}"
  m_minor="${m_minor:-0}"
  m_patch="${m_patch:-0}"

  if [ "$c_major" -gt "$m_major" ]; then return 0; fi
  if [ "$c_major" -lt "$m_major" ]; then return 1; fi
  if [ "$c_minor" -gt "$m_minor" ]; then return 0; fi
  if [ "$c_minor" -lt "$m_minor" ]; then return 1; fi
  [ "$c_patch" -ge "$m_patch" ]
}

node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
if ! version_gte "$node_version" "$MIN_NODE_VERSION"; then
  echo "ERROR: This repo requires Node >=${MIN_NODE_VERSION} (found $(node -v 2>/dev/null || echo unknown))." >&2
  echo "Run: nvm use (or install Node ${MIN_NODE_VERSION} and retry)." >&2
  exit 1
fi

INSTALL_ONLY=0
CI_MODE=0
for arg in "$@"; do
  case "$arg" in
    --install-only) INSTALL_ONLY=1 ;;
    --ci) CI_MODE=1 ;;
  esac
done

echo "==> tw-portfolio onboarding (root: $REPO_ROOT)"
FAIL=0

# ---------------------------------------------------------------------------
# 1. npm dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[1/5] Installing npm dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
echo "     Done."

# ---------------------------------------------------------------------------
# 2. Build workspace libs (needed for API dev)
# ---------------------------------------------------------------------------
echo ""
echo "[2/6] Building workspace libs..."
npm run build -w libs/domain -w libs/shared-types
echo "     Done."

# ---------------------------------------------------------------------------
# 3. Playwright browsers
# ---------------------------------------------------------------------------
echo ""
echo "[3/6] Installing Playwright browsers..."
if [ "$CI_MODE" -eq 1 ]; then
  npx playwright install --with-deps
else
  npx playwright install
fi
echo "     Done."

# ---------------------------------------------------------------------------
# 4. Playwright system deps (Linux, interactive only)
# ---------------------------------------------------------------------------
if [ "$(uname)" = "Linux" ] && [ "$CI_MODE" -eq 0 ]; then
  echo ""
  read -r -p "Install Playwright system dependencies (may need sudo)? [Y/n] " install_deps
  case "$install_deps" in
    n|N)
      echo ""
      echo "[4/6] Skipping Playwright system deps (user choice)."
      ;;
    *)
      echo ""
      echo "[4/6] Installing Playwright system dependencies (Linux)..."
      if ! npx playwright install-deps 2>/dev/null; then
        echo ""
        read -r -p "playwright install-deps requires sudo. Retry with sudo? [y/N] " ans
        if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
          sudo npx playwright install-deps
        else
          echo "     Skipped. Run 'npx playwright install-deps' manually if E2E fails."
        fi
      fi
      echo "     Done."
      ;;
  esac
else
  echo ""
  echo "[4/6] Skipping Playwright system deps (non-Linux or CI mode)."
fi

if [ "$INSTALL_ONLY" -eq 1 ]; then
  echo ""
  echo "==> Install complete (--install-only)."
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. .env from .env.example if missing (skip in CI)
# ---------------------------------------------------------------------------
if [ "$CI_MODE" -eq 0 ]; then
  echo ""
  echo "[5/6] Checking .env..."
  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      echo "     Created .env from .env.example. Edit .env if you need different DB/Redis or ports."
    else
      echo "     No .env or .env.example found. Create .env with at least: AUTH_MODE, PERSISTENCE_BACKEND, optional DB_URL, REDIS_URL (see docs/runbook.md)."
    fi
  else
    echo "     .env already exists; leaving it unchanged."
  fi
else
  echo ""
  echo "[5/6] Skipping .env (CI mode)."
fi

# ---------------------------------------------------------------------------
# 6. Sanity check (lint)
# ---------------------------------------------------------------------------
echo ""
echo "[6/6] Sanity check (lint)..."
if npm run lint; then
  echo "     Lint passed."
else
  echo "     Lint failed (see above). Fix errors and re-run if needed."
  FAIL=1
fi

# ---------------------------------------------------------------------------
# Summary and next steps
# ---------------------------------------------------------------------------
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "==> Onboarding finished successfully."
  if [ "$CI_MODE" -eq 0 ]; then
    echo ""
    echo "Next steps:"
    echo "  - If you use Postgres/Redis: start infra with"
    echo "      docker compose -f infra/docker/docker-compose.yml up -d"
    echo "  - Start API and web:  npm run dev"
    echo "  - Run tests:  npm run test:unit | npm run test:integration | npm run test:e2e"
    echo ""
  fi
else
  echo "==> Onboarding completed with errors (see above). Fix and re-run as needed."
  exit 1
fi
