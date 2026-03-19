---
name: Use routeError() in service files, never plain Error
description: Service layer throws must use routeError() from lib/routeError.ts for correct HTTP status codes
type: feedback
---

Always use `routeError(statusCode, code, message)` from `apps/api/src/lib/routeError.ts` when throwing in service files. Never use plain `throw new Error("...")`.

**Why:** The Fastify error handler in `app.ts` checks `error.statusCode` to decide the response code. Plain `Error` objects have no `statusCode`, so they fall through the `isKnownClientError()` heuristic and eventually hit `reply.code(500)`. This caused real 500s in production for client errors like "Account not found" or "Currency mismatch".

**How to apply:** Any time you add or modify a throw in `apps/api/src/services/**`, import `routeError` from `../lib/routeError.js` and call `throw routeError(404, "account_not_found", "Account not found")`. Pick the correct HTTP status (404 for missing resources, 400 for validation, 409 for conflicts).
