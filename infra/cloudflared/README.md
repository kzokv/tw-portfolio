# Cloudflare Tunnel Configuration

## Setup

The production compose file uses a token-based cloudflared tunnel (`CLOUDFLARE_TUNNEL_TOKEN`).
Configure the tunnel routes in the Cloudflare Zero Trust dashboard.

**Both hostnames are required.** If only the web hostname is added, the browser will fail to resolve the API hostname and you will see `net::ERR_NAME_NOT_RESOLVED` for API requests (e.g. `/settings`, `/portfolio/holdings`, `/settings/fee-config`).

| Public hostname                       | Service                            |
|---------------------------------------|------------------------------------|
| `vakwen-web.kzokvdevs.dpdns.org`     | `http://vakwen-prod-web:3000`      |
| `vakwen-api.kzokvdevs.dpdns.org`     | `http://vakwen-prod-api:4000`      |

The hostnames must be exactly `vakwen-web` and `vakwen-api` (not `vakwen-prod-web` / `vakwen-prod-api`), or they will not match `PUBLIC_DOMAIN_WEB` / `PUBLIC_DOMAIN_API` in `.env.prod` and the app will call hostnames that have no tunnel route (ERR_NAME_NOT_RESOLVED).

## Steps

1. Go to **Cloudflare Zero Trust** > **Networks** > **Tunnels**
2. Create a new tunnel (or select existing), copy the tunnel token
3. Add **both** public hostname routes in the table above (web and API). Each creates a CNAME so the hostname resolves.
4. Set `CLOUDFLARE_TUNNEL_TOKEN` in `infra/docker/.env.prod`
