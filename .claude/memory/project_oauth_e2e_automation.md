---
name: oauth_e2e_automation
description: OAuth e2e tests use two automated paths — refresh token (local) or hardcoded sub (CI), no manual login
type: project
---

OAuth e2e setup (`auth.setup.ts`) is fully automated with two paths:

- **Path A (local dev):** `GOOGLE_OAUTH_REFRESH_TOKEN` env var → Google token endpoint → real `id_token` → `POST /__e2e/oauth-session` → signed cookie
- **Path B (CI):** No refresh token → `POST /__e2e/oauth-session` with hardcoded sub `"e2e-ci-google-sub-001"`

**Why:** Manual Google sign-in blocked both local dev and CI automation.

**How to apply:**
- Run `npm run auth:refresh-token` to obtain/renew the refresh token (saved to `.env.local`)
- Requires `http://localhost:9876/callback` registered in Google Cloud Console
- If `invalid_grant` error appears, the refresh token expired — re-run the script
- `npm run test:e2e:oauth` runs the oauth suite; `npm run test:e2e` runs the mock suite
