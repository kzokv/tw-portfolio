import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(rootDir, "test/setup/react-global.ts")],
    reporters: ["verbose"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    outputFile: {
      html: "vitest-report/index.html",
      json: "test-results/vitest-results.json",
      junit: "test-results/junit.xml",
    },
  },
  resolve: {
    alias: {
      "@tw-portfolio/config/test": resolve(rootDir, "../../libs/config/src/test.ts"),
      "@tw-portfolio/config/web": resolve(rootDir, "../../libs/config/src/env-web.ts"),
      "@tw-portfolio/config": resolve(rootDir, "../../libs/config/src/index.ts"),
      "@tw-portfolio/domain": resolve(rootDir, "../../libs/domain/src/index.ts"),
      "@tw-portfolio/shared-types": resolve(rootDir, "../../libs/shared-types/src/index.ts"),
    },
    extensions: [".ts", ".tsx"],
  },
});
