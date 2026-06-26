import { z } from "zod";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { AppInstance } from "../app.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./market-data/registerBackfillWorker.js";
import {
  executeReplayRun,
  MCP_REPLAY_POSITION_RUN_QUEUE,
} from "./mcpPortfolioMaintenance.js";

const MCP_REPLAY_POSITION_RUN_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

const McpReplayPositionRunJobDataSchema = z.object({
  runId: z.string().trim().min(1),
}).strict();

export function createMcpReplayPositionRunHandler(app: AppInstance) {
  return async ([job]: JobWithMetadata<unknown>[]): Promise<void> => {
    const data = McpReplayPositionRunJobDataSchema.parse(job.data);
    const run = await app.persistence.getMcpReplayRun(data.runId);
    if (!run) return;
    await executeReplayRun(app, run.portfolioContextUserId, data.runId);
  };
}

export async function registerMcpReplayPositionRunWorker(app: AppInstance, boss: PgBoss): Promise<void> {
  await boss.createQueue(MCP_REPLAY_POSITION_RUN_QUEUE, MCP_REPLAY_POSITION_RUN_QUEUE_OPTIONS);
  await boss.work(
    MCP_REPLAY_POSITION_RUN_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createMcpReplayPositionRunHandler(app),
  );
  app.log.info("mcp replay position run worker registered");
}

