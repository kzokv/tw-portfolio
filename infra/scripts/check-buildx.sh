#!/usr/bin/env bash
set -euo pipefail

# Check whether Docker buildx plugin is installed.
# Exit 0 if present, exit 1 if missing (with install instructions).

if docker buildx version >/dev/null 2>&1; then
  echo "docker buildx: $(docker buildx version)"
  exit 0
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  BINARY_SUFFIX="linux-amd64" ;;
  aarch64) BINARY_SUFFIX="linux-arm64" ;;
  arm64)   BINARY_SUFFIX="darwin-arm64" ;;
  *)       BINARY_SUFFIX="linux-amd64" ;;
esac

cat <<EOF
WARNING: Docker buildx is not installed.

Without buildx, Docker Compose falls back to the legacy builder which
does not reliably bust cache on ARG changes. Deploys will use --no-cache
as a workaround (slower builds).

To install buildx on this machine ($ARCH):

  mkdir -p ~/.docker/cli-plugins
  curl -SL https://github.com/docker/buildx/releases/latest/download/buildx-v0.24.2.${BINARY_SUFFIX} \\
    -o ~/.docker/cli-plugins/docker-buildx
  chmod +x ~/.docker/cli-plugins/docker-buildx
  docker buildx version   # verify

EOF
exit 1
