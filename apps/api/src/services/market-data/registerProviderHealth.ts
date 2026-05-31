import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import { createProviderHealthService, type ProviderHealthService } from "./providerHealth.js";

export function registerProviderHealth(
  app: AppInstance,
  deps: { persistence: Persistence },
): void {
  app.providerHealth = createProviderHealthService({
    persistence: deps.persistence,
    tradingCalendar: app.tradingCalendarCache,
    log: app.log,
  });
}

declare module "fastify" {
  interface FastifyInstance {
    providerHealth: ProviderHealthService;
  }
}
