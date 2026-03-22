#!/usr/bin/env bash
# Shared dev banner — sourced by dev.sh and dev-docker.sh.
# Usage: print_banner <name> [context]
#   $1 = script name (default: "dev")
#   $2 = context: "local" or "docker" (default: "local")

_banner_var() {
  local name="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    printf '    %-24s %s\n' "$name" "$value"
  fi
}

_banner_sensitive() {
  local name="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    printf '    %-24s %s\n' "$name" "****"
  else
    printf '    %-24s %s\n' "$name" "<not set>"
  fi
}

print_banner() {
  local name="${1:-dev}"
  local context="${2:-local}"

  local header="── ${name} "
  local pad_len=$(( 48 - ${#header} ))
  local border="${header}$(printf '%*s' "$pad_len" '' | tr ' ' '─')"

  echo ""
  echo "$border"
  echo ""
  echo "  Mode-specific:"
  _banner_var "AUTH_MODE" "${AUTH_MODE:-}"
  _banner_var "PERSISTENCE_BACKEND" "${PERSISTENCE_BACKEND:-}"

  # Persistence-dependent vars
  if [[ "${PERSISTENCE_BACKEND:-}" == "postgres" ]]; then
    _banner_var "DB_URL" "${DB_URL:-}"
    _banner_var "REDIS_URL" "${REDIS_URL:-}"
  fi

  # Auth-dependent vars
  if [[ "${AUTH_MODE:-}" == "oauth" ]]; then
    _banner_sensitive "SESSION_SECRET" "${SESSION_SECRET:-}"
    _banner_sensitive "GOOGLE_CLIENT_ID" "${GOOGLE_CLIENT_ID:-}"
    _banner_sensitive "GOOGLE_CLIENT_SECRET" "${GOOGLE_CLIENT_SECRET:-}"
    _banner_var "GOOGLE_REDIRECT_URI" "${GOOGLE_REDIRECT_URI:-}"
    _banner_var "COOKIE_DOMAIN" "${COOKIE_DOMAIN:-}"
  fi

  # Docker-specific vars
  if [[ "$context" == "docker" ]]; then
    _banner_var "PUBLIC_DOMAIN_WEB" "${PUBLIC_DOMAIN_WEB:-}"
    _banner_var "PUBLIC_DOMAIN_API" "${PUBLIC_DOMAIN_API:-}"
    _banner_sensitive "CLOUDFLARE_TUNNEL_TOKEN" "${CLOUDFLARE_TUNNEL_TOKEN:-}"
    _banner_sensitive "POSTGRES_PASSWORD" "${POSTGRES_PASSWORD:-}"
    _banner_sensitive "REDIS_PASSWORD" "${REDIS_PASSWORD:-}"
  fi

  # Inherited section (local context only)
  if [[ "$context" == "local" ]]; then
    echo ""
    echo "  Inherited:"
    _banner_var "NODE_ENV" "${NODE_ENV:-}"
    _banner_var "API_PORT" "${API_PORT:-}"
    _banner_var "WEB_PORT" "${WEB_PORT:-}"
    _banner_var "ALLOWED_ORIGINS" "${ALLOWED_ORIGINS:-}"
    _banner_var "SESSION_COOKIE_NAME" "${SESSION_COOKIE_NAME:-}"
    _banner_var "APP_BASE_URL" "${APP_BASE_URL:-}"
    _banner_var "NEXT_PUBLIC_AUTH_MODE" "${NEXT_PUBLIC_AUTH_MODE:-}"
    _banner_var "NEXT_PUBLIC_API_BASE_URL" "${NEXT_PUBLIC_API_BASE_URL:-}"
  fi

  echo ""
  echo "────────────────────────────────────────────────"
  echo ""
}
