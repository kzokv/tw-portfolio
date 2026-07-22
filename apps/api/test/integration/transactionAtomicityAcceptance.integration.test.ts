import { afterEach, beforeEach, describe, it } from "vitest";
import { buildApp } from "../../src/app.js";
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

describe("transaction atomicity acceptance (memory)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", registerWorkers: false });
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

  it("serializes stock-dividend creation before a competing SELL", async () => {
    await verifyStockDividendCreationSellRace(app);
  });

  it("serializes stock-dividend receipt updates before a competing SELL", async () => {
    await verifyStockDividendUpdateSellRace(app);
  });

  it("rolls back an invalid scoped writer before allowing the next queued writer", async () => {
    await verifyInvalidReplayWriterRollback(app);
  });

  it("keeps a newer writer queued behind a replay paused after authoritative source reads", async () => {
    await verifyLockedReplayQueuesNewerWriter(app);
  });

  it("queues a newer write behind MCP maintenance replay and preserves both commits", async () => {
    await verifyMcpMaintenanceReplayQueuesNewerWriter(app);
  });

  it("queues a newer write behind synchronous posted-mutation rebuild and preserves both commits", async () => {
    await verifyPostedMutationRebuildQueuesNewerWriter(app);
  });
});
