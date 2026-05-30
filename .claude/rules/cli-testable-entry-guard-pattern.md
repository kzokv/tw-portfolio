# CLI Testable Entry Guard Pattern

Any new admin/operator CLI script under `apps/api/src/cli/**` must export its entry function and gate self-invocation behind an `import.meta.url` check. Do NOT use `void main();` at module top-level.

**Shape:**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function main(argv: string[]): Promise<void> {
  // Read all CLI args from argv[N], NOT process.argv[N].
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main(process.argv);
}
```

**Required details:**

1. Signature: `export async function main(argv: string[]): Promise<void>`. Callers inject argv explicitly; `main` never reads `process.argv` directly.
2. The guard uses `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`. Do NOT use the literal `"file://" + process.argv[1]` form — the `fileURLToPath` / `path.resolve` pairing is load-bearing so integration tests can `await import(...)` and call `main(...)` without triggering the guard, while direct `node path/to/script.js` invocation still runs the CLI.
3. Catch `z.ZodError` for any CLI-arg Zod parse and pretty-print (`invalid email: ...`, `invalid role: ...`) + `process.exitCode = 1` + `return`. Never let a raw stack trace reach the operator — that was the observed behavior before KZO-153.
4. Exit contract: on any error path set `process.exitCode = 1` and `return`. Do NOT `process.exit()`; tests rely on awaiting `main(argv)` and then reading `process.exitCode`.

**Why:** KZO-153 refactored `adminPromote.ts` and `adminBootstrapInvite.ts` to add deferred integration-test coverage. Integration tests now drive the CLI in-process via `await import("../../src/cli/adminPromote.js")` + `main(["node","script",...args])`, checking `stdout`, `stderr`, and `process.exitCode` without spawning subprocesses. Shell-spawn coverage would add ~2 min runtime for zero additional regression signal. The `import.meta.url` guard is the canonical Node-ESM pattern for "run iff invoked directly," and the `path.resolve(process.argv[1])` comparison normalizes the path string so it matches the file URL form.

**How to apply:** Every new script added to `apps/api/src/cli/**`, and when modifying an existing CLI that previously used `void main();` top-level execution. Applies any time the CLI is intended to have integration tests, and is a safe default even when it doesn't (no runtime cost). Pair with the `runMain(cliModule, argv)` helper pattern in `apps/api/test/integration/admin-cli.integration.test.ts` — spy `console.log` / `console.error`, reset `process.exitCode = 0`, await `main(argv)`, then capture + restore.
