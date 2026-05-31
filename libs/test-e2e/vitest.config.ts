import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { NODE_ENV: "test" },
    reporters: ["verbose"],
    include: ["test/**/*.test.ts"],
  },
});
