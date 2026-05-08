// KZO-198 Fix 5 — the 3 cron schedule constants source from `Env.X_CRON`
// rather than inlined literals. Restart-required overrides (Tier 3) reach
// the actual scheduler this way.
import { describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import { CATALOG_SYNC_CRON } from "../../../src/services/market-data/registerCatalogSyncWorker.js";
import { FX_REFRESH_CRON } from "../../../src/services/market-data/fxRefreshWorker.js";
import { ANONYMOUS_SHARE_TOKEN_PURGE_CRON } from "../../../src/services/registerAnonymousShareTokenPurgeWorker.js";

describe("KZO-198 — cron constants source from Env", () => {
  it("CATALOG_SYNC_CRON === Env.CATALOG_SYNC_CRON", () => {
    expect(CATALOG_SYNC_CRON).toBe(Env.CATALOG_SYNC_CRON);
  });

  it("FX_REFRESH_CRON === Env.FX_REFRESH_CRON", () => {
    expect(FX_REFRESH_CRON).toBe(Env.FX_REFRESH_CRON);
  });

  it("ANONYMOUS_SHARE_TOKEN_PURGE_CRON === Env.ANONYMOUS_SHARE_TOKEN_PURGE_CRON", () => {
    expect(ANONYMOUS_SHARE_TOKEN_PURGE_CRON).toBe(Env.ANONYMOUS_SHARE_TOKEN_PURGE_CRON);
  });

  it("env-default values match the documented schedules", () => {
    // Sanity check the env-schema defaults — `.env.example` documents these.
    expect(Env.CATALOG_SYNC_CRON).toBe("30 17 * * 1-5");
    expect(Env.FX_REFRESH_CRON).toBe("0 22 * * *");
    expect(Env.ANONYMOUS_SHARE_TOKEN_PURGE_CRON).toBe("0 4 * * *");
  });
});
