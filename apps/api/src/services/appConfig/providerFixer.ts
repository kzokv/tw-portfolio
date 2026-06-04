import { getAppConfigCacheEntry } from "./cache.js";

export const PROVIDER_FIXER_DEFAULTS = {
  dangerousMatchThreshold: 500,
  previewSampleLimit: 50,
  uiPageSize: 25,
  autoPauseFailuresPerMinute: 120,
  previewTokenTtlMinutes: 30,
  autoRenewIntervalMinutes: 60,
  incidentRecurrenceWindowMinutes: 30,
  healthWarningUnresolvedThreshold: 1_000,
  healthCriticalUnresolvedThreshold: 10_000,
  staleHeartbeatMinutes: 15,
  operationSummaryRetentionDays: 90,
  operationLogRetentionDays: 30,
  incidentRetentionDays: 180,
  resolvedItemRetentionDays: 30,
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

export function getEffectiveProviderOperationAutoRenewIntervalMinutes(): number {
  return (
    getAppConfigCacheEntry()?.providerOperationAutoRenewIntervalMinutes ??
    PROVIDER_FIXER_DEFAULTS.autoRenewIntervalMinutes
  );
}

export function getEffectiveProviderIncidentRecurrenceWindowMinutes(): number {
  return (
    getAppConfigCacheEntry()?.providerIncidentRecurrenceWindowMinutes ??
    PROVIDER_FIXER_DEFAULTS.incidentRecurrenceWindowMinutes
  );
}

export function getEffectiveProviderHealthWarningUnresolvedThreshold(): number {
  return (
    getAppConfigCacheEntry()?.providerHealthWarningUnresolvedThreshold ??
    PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold
  );
}

export function getEffectiveProviderHealthCriticalUnresolvedThreshold(): number {
  return (
    getAppConfigCacheEntry()?.providerHealthCriticalUnresolvedThreshold ??
    PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold
  );
}

export function getEffectiveProviderOperationStaleHeartbeatMinutes(): number {
  return (
    getAppConfigCacheEntry()?.providerOperationStaleHeartbeatMinutes ??
    PROVIDER_FIXER_DEFAULTS.staleHeartbeatMinutes
  );
}

export function getEffectiveProviderOperationSummaryRetentionDays(): number {
  return (
    getAppConfigCacheEntry()?.providerOperationSummaryRetentionDays ??
    PROVIDER_FIXER_DEFAULTS.operationSummaryRetentionDays
  );
}

export function getEffectiveProviderOperationLogRetentionDays(): number {
  return (
    getAppConfigCacheEntry()?.providerOperationLogRetentionDays ??
    PROVIDER_FIXER_DEFAULTS.operationLogRetentionDays
  );
}

export function getEffectiveProviderIncidentRetentionDays(): number {
  return (
    getAppConfigCacheEntry()?.providerIncidentRetentionDays ??
    PROVIDER_FIXER_DEFAULTS.incidentRetentionDays
  );
}

export function getEffectiveProviderResolvedItemRetentionDays(): number {
  return (
    getAppConfigCacheEntry()?.providerResolvedItemRetentionDays ??
    PROVIDER_FIXER_DEFAULTS.resolvedItemRetentionDays
  );
}
