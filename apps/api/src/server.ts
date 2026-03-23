import { buildApp } from "./app.js";
import { Env } from "@tw-portfolio/config";
import { cleanupExpiredDemoUsers } from "./services/demoCleanup.js";
import type { PostgresPersistence } from "./persistence/postgres.js";

async function start() {
  Env.validateEnvConstraints();
  const app = await buildApp();
  // Demo cleanup interval — only for postgres backend with demo mode enabled
  if (Env.PERSISTENCE_BACKEND === "postgres" && Env.DEMO_MODE_ENABLED === "true") {
    const pool = (app.persistence as PostgresPersistence).getPool();
    const cleanupIntervalMs = 15 * 60_000; // 15 minutes

    const intervalHandle = setInterval(async () => {
      try {
        await cleanupExpiredDemoUsers(pool);
      } catch (err) {
        console.error("[demo-cleanup] Interval cleanup error:", err);
      }
    }, cleanupIntervalMs);

    app.addHook("onClose", async () => {
      clearInterval(intervalHandle);
    });
  }

  await app.listen({ host: "::", port: Env.API_PORT });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
