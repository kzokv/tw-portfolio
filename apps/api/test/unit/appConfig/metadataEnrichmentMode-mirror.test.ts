// KZO-198 — Mirror tests for `getEffectiveMetadataEnrichmentMode` at the
// migrated path `apps/api/src/services/appConfig/metadataEnrichmentMode.ts`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import { getEffectiveMetadataEnrichmentMode } from "../../../src/services/appConfig/metadataEnrichmentMode.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("appConfig/metadataEnrichmentMode — getEffectiveMetadataEnrichmentMode (cache-driven)", () => {
  it("returns Env.METADATA_ENRICHMENT_MODE when cache entry is null", () => {
    expect(getEffectiveMetadataEnrichmentMode()).toBe(Env.METADATA_ENRICHMENT_MODE);
  });

  it("returns 'unconditional' when app_config has 'unconditional'", async () => {
    await seedCache({ metadataEnrichmentMode: "unconditional" }, cacheModule);
    expect(getEffectiveMetadataEnrichmentMode()).toBe("unconditional");
  });

  it("returns 'conditional' when app_config has 'conditional'", async () => {
    await seedCache({ metadataEnrichmentMode: "conditional" }, cacheModule);
    expect(getEffectiveMetadataEnrichmentMode()).toBe("conditional");
  });

  it("returns Env default when app_config column is NULL after a refresh", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
    await refresh();
    expect(getEffectiveMetadataEnrichmentMode()).toBe(Env.METADATA_ENRICHMENT_MODE);
  });
});
