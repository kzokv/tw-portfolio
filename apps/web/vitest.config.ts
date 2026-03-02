import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["verbose"],
    include: ["test/**/*.test.ts"],
    outputFile: {
      html: "vitest-report/index.html",
      json: "test-results/vitest-results.json",
      junit: "test-results/junit.xml",
    },
  },
  resolve: {
    extensions: [".ts", ".tsx"],
  },
});
