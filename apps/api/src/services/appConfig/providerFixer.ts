import { getAppConfigCacheEntry } from "./cache.js";

export const PROVIDER_FIXER_DEFAULTS = {
  dangerousMatchThreshold: 500,
  previewSampleLimit: 50,
  uiPageSize: 25,
  autoPauseFailuresPerMinute: 120,
  previewTokenTtlMinutes: 30,
} as const;

export function getEffectiveProviderFixerDangerousMatchThreshold(): number {
  return (
    getAppConfigCacheEntry()?.providerFixerDangerousMatchThreshold ??
    PROVIDER_FIXER_DEFAULTS.dangerousMatchThreshold
  );
}

export function getEffectiveProviderFixerPreviewSampleLimit(): number {
  return (
    getAppConfigCacheEntry()?.providerFixerPreviewSampleLimit ??
    PROVIDER_FIXER_DEFAULTS.previewSampleLimit
  );
}

export function getEffectiveProviderFixerUiPageSize(): number {
  return (
    getAppConfigCacheEntry()?.providerFixerUiPageSize ??
    PROVIDER_FIXER_DEFAULTS.uiPageSize
  );
}

export function getEffectiveProviderFixerAutoPauseFailuresPerMinute(): number {
  return (
    getAppConfigCacheEntry()?.providerFixerAutoPauseFailuresPerMinute ??
    PROVIDER_FIXER_DEFAULTS.autoPauseFailuresPerMinute
  );
}

export function getEffectiveProviderFixerPreviewTokenTtlMinutes(): number {
  return (
    getAppConfigCacheEntry()?.providerFixerPreviewTokenTtlMinutes ??
    PROVIDER_FIXER_DEFAULTS.previewTokenTtlMinutes
  );
}

