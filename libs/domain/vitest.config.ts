import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@vakwen/domain": resolve(rootDir, "src/index.ts"),
      "@vakwen/shared-types": resolve(
        rootDir,
        "../shared-types/src/index.ts",
      ),
    },
  },
});
