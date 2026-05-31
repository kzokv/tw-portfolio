import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Force dev_bypass so tests are not affected by a local .env.local with AUTH_MODE=oauth.
    env: { AUTH_MODE: "dev_bypass", NODE_ENV: "test" },
    reporters: ["verbose"],
    include: ["test/**/*.test.ts"],
  },
});
