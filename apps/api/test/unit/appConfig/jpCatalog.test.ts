import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveJpCatalogAllowedStockTypes,
  getEffectiveJpCatalogIncludeAtSymbols,
  getEffectiveJpCatalogIncludeDepositaryReceipts,
  getEffectiveJpCatalogInclusionConfig,
} from "../../../src/services/appConfig/jpCatalog.js";
import { seedCache } from "./_helpers.js";

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

describe("appConfig/jpCatalog", () => {
  it("defaults to strict JP catalog inclusion when app_config is unset", () => {
    expect(getEffectiveJpCatalogAllowedStockTypes()).toEqual([
      "Common Stock",
      "Preferred Stock",
      "REIT",
    ]);
    expect(getEffectiveJpCatalogIncludeDepositaryReceipts()).toBe(false);
    expect(getEffectiveJpCatalogIncludeAtSymbols()).toBe(false);
    expect(getEffectiveJpCatalogInclusionConfig()).toEqual({
      allowedStockTypes: new Set(["Common Stock", "Preferred Stock", "REIT"]),
      includeDepositaryReceipts: false,
      includeAtSymbols: false,
    });
  });

  it("honors relaxed JP inclusion overrides and de-duplicates allowed stock types", async () => {
    await seedCache({
      jpCatalogAllowedStockTypes: [
        "REIT",
        "Depositary Receipt",
        "REIT",
        "Common Stock",
      ],
      jpCatalogIncludeDepositaryReceipts: true,
      jpCatalogIncludeAtSymbols: true,
    }, cacheModule);

    expect(getEffectiveJpCatalogAllowedStockTypes()).toEqual([
      "REIT",
      "Depositary Receipt",
      "Common Stock",
    ]);
    expect(getEffectiveJpCatalogIncludeDepositaryReceipts()).toBe(true);
    expect(getEffectiveJpCatalogIncludeAtSymbols()).toBe(true);
    expect(getEffectiveJpCatalogInclusionConfig()).toEqual({
      allowedStockTypes: new Set(["REIT", "Depositary Receipt", "Common Stock"]),
      includeDepositaryReceipts: true,
      includeAtSymbols: true,
    });
  });
});
