import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import { TradingCalendarCache } from "./tradingCalendar.js";

export function registerTradingCalendarCache(
  app: AppInstance,
  deps: { persistence: Persistence },
): void {
  app.tradingCalendarCache = new TradingCalendarCache({
    persistence: deps.persistence,
    log: app.log,
  });
}

declare module "fastify" {
  interface FastifyInstance {
    tradingCalendarCache: TradingCalendarCache;
  }
}
