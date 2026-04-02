#!/usr/bin/env bash
set -euo pipefail

# Check whether Docker buildx plugin is installed and working.
# If missing or broken, attempt automatic install.
# Exit 0 if buildx is usable, exit 1 if install failed (deploy continues
# with --no-cache fallback).

ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "${OS}-${ARCH}" in
  linux-x86_64)  BINARY_SUFFIX="linux-amd64" ;;
  linux-aarch64) BINARY_SUFFIX="linux-arm64" ;;
  darwin-arm64)  BINARY_SUFFIX="darwin-arm64" ;;
  darwin-x86_64) BINARY_SUFFIX="darwin-amd64" ;;
  *)             BINARY_SUFFIX="linux-amd64" ;;
esac

PLUGIN_DIR="${HOME}/.docker/cli-plugins"
PLUGIN_PATH="${PLUGIN_DIR}/docker-buildx"

# --- Check current state ---

BUILDX_OUTPUT=""
if BUILDX_OUTPUT="$(docker buildx version 2>&1)"; then
  echo "docker buildx: $BUILDX_OUTPUT"
  exit 0
fi

# --- Diagnose failure reason ---

if echo "$BUILDX_OUTPUT" | grep -qi "exec format error"; then
  echo "WARNING: buildx binary is wrong architecture for ${OS}/${ARCH}"
  rm -f "$PLUGIN_PATH"
fi

# --- Resolve latest version ---

BUILDX_VERSION=""
if command -v curl >/dev/null 2>&1; then
  BUILDX_VERSION="$(curl -fsSI -o /dev/null -w '%{redirect_url}' \
    "https://github.com/docker/buildx/releases/latest" 2>/dev/null \
    | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' || true)"
fi

if [ -z "$BUILDX_VERSION" ]; then
  echo "WARNING: Could not resolve latest buildx version. Deploy will use --no-cache fallback."
  exit 1
fi

DOWNLOAD_URL="https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.${BINARY_SUFFIX}"

# --- Attempt automatic install ---

echo "Installing buildx ${BUILDX_VERSION} for ${OS}/${ARCH}..."

mkdir -p "$PLUGIN_DIR"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$PLUGIN_PATH"; then
  echo "WARNING: buildx download failed. Deploy will use --no-cache fallback."
  rm -f "$PLUGIN_PATH"
  exit 1
fi

chmod +x "$PLUGIN_PATH"

# --- Verify install ---

if BUILDX_OUTPUT="$(docker buildx version 2>&1)"; then
  echo "docker buildx installed: $BUILDX_OUTPUT"
  exit 0
fi

echo "WARNING: buildx install failed verification. Deploy will use --no-cache fallback."
rm -f "$PLUGIN_PATH"
exit 1
