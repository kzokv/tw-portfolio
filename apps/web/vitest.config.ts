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
    // Several component suites mount large jsdom trees and Radix primitives.
    // Serial file execution keeps the official web unit gate deterministic on
    // constrained dev/CI runners without weakening per-test timeouts.
    fileParallelism: false,
    setupFiles: [
      resolve(rootDir, "test/setup/react-global.ts"),
      resolve(rootDir, "test/setup/next-mocks.ts"),
    ],
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
      "next/link": resolve(rootDir, "test/setup/next-stubs/link.tsx"),
      "next/navigation": resolve(rootDir, "test/setup/next-stubs/navigation.ts"),
      "next/headers": resolve(rootDir, "test/setup/next-stubs/headers.ts"),
      "next/dynamic": resolve(rootDir, "test/setup/next-stubs/dynamic.tsx"),
      "@vakwen/config/test": resolve(rootDir, "../../libs/config/src/test.ts"),
      "@vakwen/config/web": resolve(rootDir, "../../libs/config/src/env-web.ts"),
      "@vakwen/config": resolve(rootDir, "../../libs/config/src/index.ts"),
      "@vakwen/domain": resolve(rootDir, "../../libs/domain/src/index.ts"),
      "@vakwen/shared-types": resolve(rootDir, "../../libs/shared-types/src/index.ts"),
      "@/": `${rootDir}/`,
    },
    extensions: [".ts", ".tsx"],
  },
});
