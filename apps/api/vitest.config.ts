import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const isManagedPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const apiSuiteTimeoutMs = 30_000;
const managedPostgresTimeoutMs = 180_000;

export default defineConfig({
  test: {
    // Force dev_bypass + memory backend so tests are deterministic regardless of a
    // local .env.local. `assertE2ESeedEnabled` reads `Env.PERSISTENCE_BACKEND` directly
    // (not `app.persistence`), so CI (no `.env.local` → default "postgres") would
    // otherwise 404 on /__e2e/seed-* even when buildApp is passed memory.
    // KZO-164: FX_PROVIDER_MOCK=true forces the deterministic Frankfurter mock so the
    // registry never reaches the real Frankfurter API in unit/integration tests.
    env: {
      AUTH_MODE: "dev_bypass",
      NODE_ENV: "test",
      PERSISTENCE_BACKEND: "memory",
      FX_PROVIDER_MOCK: "true",
      APP_CONFIG_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    // @ts-expect-error globalTeardown is supported at runtime but missing from InlineConfig in this Vitest version
    globalTeardown: "./test/globalTeardown.ts",
    // Default: terminal only. Use npm scripts or CLI to generate file reports:
    //   npm run test:html  → vitest-report/ (view: npx vite preview --outDir vitest-report)
    //   npm run test:json  → test-results/vitest-results.json
    //   npm run test:junit → test-results/junit.xml
    reporters: ["verbose"],
    include: ["test/**/*.test.ts", "test/**/*.integration.test.ts"],
    // The API package boots many Fastify app instances and provider registries.
    // Bounding workers avoids host/VM contention that can make unrelated tests
    // hit Vitest's very small defaults during full-package runs.
    maxWorkers: 4,
    ...(isManagedPostgresIntegration
      ? {
          // The managed Postgres gate runs against a Docker DB/Redis stack and
          // several migration-heavy files legitimately exceed normal API budgets
          // on host/VM runners.
          hookTimeout: managedPostgresTimeoutMs,
          teardownTimeout: managedPostgresTimeoutMs,
          testTimeout: managedPostgresTimeoutMs,
        }
      : {
          hookTimeout: apiSuiteTimeoutMs,
          teardownTimeout: apiSuiteTimeoutMs,
          testTimeout: apiSuiteTimeoutMs,
        }),
    outputFile: {
      html: "vitest-report/index.html",
      json: "test-results/vitest-results.json",
      junit: "test-results/junit.xml",
    },
  },
  resolve: {
    alias: {
      "@vakwen/config": resolve(rootDir, "../../libs/config/src/index.ts"),
      "@vakwen/domain": resolve(rootDir, "../../libs/domain/src/index.ts"),
      "@vakwen/shared-types": resolve(rootDir, "../../libs/shared-types/src/index.ts"),
    },
    extensions: [".ts"],
  },
});
