import { buildApp } from "./app.js";
import { Env } from "@tw-portfolio/config";

async function start() {
  Env.validatePortConflicts();
  const app = await buildApp();
  await app.listen({ host: "::", port: Env.API_PORT });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
