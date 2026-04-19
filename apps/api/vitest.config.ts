import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    // Force dev_bypass + memory backend so tests are deterministic regardless of a
    // local .env.local. `assertE2ESeedEnabled` reads `Env.PERSISTENCE_BACKEND` directly
    // (not `app.persistence`), so CI (no `.env.local` → default "postgres") would
    // otherwise 404 on /__e2e/seed-* even when buildApp is passed memory.
    env: { AUTH_MODE: "dev_bypass", NODE_ENV: "test", PERSISTENCE_BACKEND: "memory" },
    globalTeardown: "./test/globalTeardown.ts",
    // Default: terminal only. Use npm scripts or CLI to generate file reports:
    //   npm run test:html  → vitest-report/ (view: npx vite preview --outDir vitest-report)
    //   npm run test:json  → test-results/vitest-results.json
    //   npm run test:junit → test-results/junit.xml
    reporters: ["verbose"],
    include: ["test/**/*.test.ts", "test/**/*.integration.test.ts"],
    outputFile: {
      html: "vitest-report/index.html",
      json: "test-results/vitest-results.json",
      junit: "test-results/junit.xml",
    },
  },
  resolve: {
    alias: {
      "@tw-portfolio/config": resolve(rootDir, "../../libs/config/src/index.ts"),
      "@tw-portfolio/domain": resolve(rootDir, "../../libs/domain/src/index.ts"),
      "@tw-portfolio/shared-types": resolve(rootDir, "../../libs/shared-types/src/index.ts"),
    },
    extensions: [".ts"],
  },
});
