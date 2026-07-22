vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass",
      getDatabaseUrl: () => process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL ?? original.Env.getDatabaseUrl(),
      getRedisUrl: () => process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL ?? original.Env.getRedisUrl(),
    },
  };
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import {
  verifyBackdatedSellReplayCommit,
  verifyDecreasingActionSellRace,
  verifyIncreasingActionSellRace,
  verifyInvalidReplayWriterRollback,
  verifyLockedReplayQueuesNewerWriter,
  verifyMcpMaintenanceReplayQueuesNewerWriter,
  verifyPostedMutationRebuildQueuesNewerWriter,
  verifyStockDividendCreationSellRace,
  verifyStockDividendUpdateSellRace,
} from "../helpers/transactionAtomicityAcceptance.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or "
      + "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const describePostgres = runPostgresIntegration && databaseUrl && redisUrl ? describe : describe.skip;

async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
    await pool.end();
  }
}

async function applyBaselineMigration(): Promise<void> {
  const manifest = await migrationManifestPromise;
  if (!manifest.baselineMigration) throw new Error("expected a baseline migration for managed Postgres tests");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(await fs.readFile(path.join(migrationsDir, manifest.baselineMigration), "utf8"));
  } finally {
    client.release();
    await pool.end();
  }
}

describePostgres("transaction atomicity acceptance (Postgres)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await resetDatabase();
    await applyBaselineMigration();
    app = await buildApp({
      persistenceBackend: "postgres",
      postgresPoolMax: 1,
      registerWorkers: false,
    });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("serializes a quantity-increasing position action before a competing SELL", async () => {
    await verifyIncreasingActionSellRace(app);
  });

  it("serializes a quantity-decreasing position action before rejecting a competing SELL", async () => {
    await verifyDecreasingActionSellRace(app);
  });

  it("atomically persists the complete replay when a valid backdated SELL reallocates a later SELL", async () => {
    await verifyBackdatedSellReplayCommit(app);
  });

  it("serializes stock-dividend creation before a competing SELL with a single-client pool", async () => {
    await verifyStockDividendCreationSellRace(app);
  });

  it("serializes stock-dividend receipt updates before a competing SELL with a single-client pool", async () => {
    await verifyStockDividendUpdateSellRace(app);
  });

  it("rolls back an invalid scoped writer and reuses the single client for the next queued writer", async () => {
    await verifyInvalidReplayWriterRollback(app);
  });

  it("queues a newer writer behind source-read replay while using a single-client pool", async () => {
    await verifyLockedReplayQueuesNewerWriter(app);
  });

  it("queues a newer write behind MCP maintenance replay with a single-client pool", async () => {
    await verifyMcpMaintenanceReplayQueuesNewerWriter(app);
  });

  it("queues a newer write behind synchronous posted-mutation rebuild with a single-client pool", async () => {
    await verifyPostedMutationRebuildQueuesNewerWriter(app);
  });
});
