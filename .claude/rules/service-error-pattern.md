# Service Error Pattern

Always use `routeError(statusCode, code, message)` from `apps/api/src/lib/routeError.ts` when throwing in service files. Never use plain `throw new Error("...")`.

```ts
// ✅ Correct
throw routeError(404, "account_not_found", "Account not found");

// ❌ Wrong — produces 500 instead of the intended status code
throw new Error("Account not found");
```

Pick the correct HTTP status: 404 for missing resources, 400 for validation, 409 for conflicts.

**Why:** The Fastify error handler in `app.ts` checks `error.statusCode` to decide the response code. Plain `Error` objects have no `statusCode`, so they fall through `isKnownClientError()` and hit `reply.code(500)`. This caused real 500s in production for client errors.

**How to apply:** Any time you add or modify a throw in `apps/api/src/services/**`, import `routeError` from `../lib/routeError.js` and use it with the appropriate HTTP status code.
