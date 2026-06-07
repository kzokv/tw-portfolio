import type { JobWithMetadata, PgBoss } from "pg-boss";
import { z } from "zod";
import type { AppInstance } from "../../app.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";

export const PROVIDER_OPERATION_EXECUTION_QUEUE = "provider-operation-execution";

const PROVIDER_OPERATION_EXECUTION_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export const ProviderOperationExecutionJobDataSchema = z
  .object({
    operationId: z.string().trim().min(1),
    actorUserId: z.string().trim().min(1),
    ipAddress: z.string().trim().optional(),
  })
  .strict();

export type ProviderOperationExecutionJobData = z.infer<typeof ProviderOperationExecutionJobDataSchema>;

export function providerOperationExecutionSingletonKey(operationId: string): string {
  return `${PROVIDER_OPERATION_EXECUTION_QUEUE}:${operationId}`;
}

export function createProviderOperationExecutionHandler(app: AppInstance) {
  return async ([job]: JobWithMetadata<unknown>[]): Promise<void> => {
    const data = ProviderOperationExecutionJobDataSchema.parse(job.data);
    if (!app.providerOperationExecutor) {
      throw new Error("provider operation executor is not registered");
    }
    await app.providerOperationExecutor(data);
  };
}

export async function registerProviderOperationExecutionWorker(
  app: AppInstance,
  boss: PgBoss,
): Promise<void> {
  await boss.createQueue(PROVIDER_OPERATION_EXECUTION_QUEUE, PROVIDER_OPERATION_EXECUTION_QUEUE_OPTIONS);
  await boss.work(
    PROVIDER_OPERATION_EXECUTION_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createProviderOperationExecutionHandler(app),
  );
  app.log.info("provider operation execution worker registered");
}
