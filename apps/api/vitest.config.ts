import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
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
      "@tw-portfolio/domain": resolve(rootDir, "../../libs/domain/src/index.ts"),
      "@tw-portfolio/shared-types": resolve(rootDir, "../../libs/shared-types/src/index.ts"),
    },
    extensions: [".ts"],
  },
});
