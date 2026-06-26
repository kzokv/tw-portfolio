import {
  JP_CATALOG_STRICT_STOCK_TYPES,
  type JpCatalogStockType,
} from "@vakwen/shared-types";
import { getAppConfigCacheEntry } from "./cache.js";

export interface JpCatalogInclusionConfig {
  allowedStockTypes: ReadonlySet<JpCatalogStockType>;
  includeDepositaryReceipts: boolean;
  includeAtSymbols: boolean;
}

export function getEffectiveJpCatalogAllowedStockTypes(): JpCatalogStockType[] {
  const override = getAppConfigCacheEntry()?.jpCatalogAllowedStockTypes ?? null;
  if (!Array.isArray(override) || override.length === 0) {
    return [...JP_CATALOG_STRICT_STOCK_TYPES];
  }
  return [...new Set(override)];
}

export function getEffectiveJpCatalogIncludeDepositaryReceipts(): boolean {
  return getAppConfigCacheEntry()?.jpCatalogIncludeDepositaryReceipts ?? false;
}

export function getEffectiveJpCatalogIncludeAtSymbols(): boolean {
  return getAppConfigCacheEntry()?.jpCatalogIncludeAtSymbols ?? false;
}

export function getEffectiveJpCatalogInclusionConfig(): JpCatalogInclusionConfig {
  return {
    allowedStockTypes: new Set(getEffectiveJpCatalogAllowedStockTypes()),
    includeDepositaryReceipts: getEffectiveJpCatalogIncludeDepositaryReceipts(),
    includeAtSymbols: getEffectiveJpCatalogIncludeAtSymbols(),
  };
}
