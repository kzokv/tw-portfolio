import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tw-portfolio/domain": resolve(rootDir, "src/index.ts"),
      "@tw-portfolio/shared-types": resolve(
        rootDir,
        "../shared-types/src/index.ts",
      ),
    },
  },
});
