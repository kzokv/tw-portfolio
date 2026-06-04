import {
  PROVIDER_OPERATION_ACTIONS,
  type ProviderOperationAction,
  type ProviderOperationActionCapabilityDto,
  type ProviderOperationCapabilityDto,
  type ProviderOperationGuardrailLevel,
} from "@vakwen/shared-types";

interface ProviderCapabilityDefinition {
  supportsMappings: boolean;
  supportsRepair: boolean;
  supportsRenew: boolean;
  supportsRerun: boolean;
  supportsResolverModes: boolean;
  emptyMappingReason: string;
  supportedActions: Partial<Record<ProviderOperationAction, ProviderOperationGuardrailLevel>>;
  disabledReasons?: Partial<Record<ProviderOperationAction, string>>;
}

const DEFAULT_DISABLED_REASONS: Record<ProviderOperationAction, string> = {
  renew_evidence: "Renew is unavailable for this provider.",
  repair_mapping: "Repair is unavailable because this provider has no mapping resolver.",
  rerun_backfill: "Rerun is unavailable for this provider or provider plan.",
  reverify_mapping: "Reverify is unavailable because this provider has no durable mappings.",
  revert_mapping: "Revert is unavailable because this provider has no durable mappings.",
  purge_logs: "Purge logs is unavailable for this provider.",
  normalize_errors: "Normalize errors is unavailable for this provider.",
  mark_unsupported: "Mark unsupported is unavailable for this provider.",
  ignore_unresolved: "Ignore unresolved item is unavailable for this provider.",
  reopen_unresolved: "Reopen unresolved item is unavailable for this provider.",
  refresh_health: "Refresh health is unavailable for this provider.",
};

const WRITE_PROVIDER_ACTIONS: Partial<Record<ProviderOperationAction, ProviderOperationGuardrailLevel>> = {
  renew_evidence: "checkbox",
  rerun_backfill: "checkbox",
  purge_logs: "typed_preview",
  normalize_errors: "checkbox",
  mark_unsupported: "none",
  ignore_unresolved: "none",
  reopen_unresolved: "none",
  refresh_health: "none",
};

const MAPPING_PROVIDER_ACTIONS: Partial<Record<ProviderOperationAction, ProviderOperationGuardrailLevel>> = {
  repair_mapping: "typed_preview",
  reverify_mapping: "checkbox",
  revert_mapping: "typed_preview",
};

const DEFAULT_DEFINITION: ProviderCapabilityDefinition = {
  supportsMappings: false,
  supportsRepair: false,
  supportsRenew: true,
  supportsRerun: false,
  supportsResolverModes: false,
  emptyMappingReason: "This provider does not expose durable mappings yet.",
  supportedActions: {
    renew_evidence: "checkbox",
    purge_logs: "typed_preview",
    normalize_errors: "checkbox",
    mark_unsupported: "none",
    ignore_unresolved: "none",
    reopen_unresolved: "none",
    refresh_health: "none",
  },
};

const PROVIDER_CAPABILITY_DEFINITIONS: Record<string, ProviderCapabilityDefinition> = {
  "yahoo-finance-kr": {
    supportsMappings: true,
    supportsRepair: true,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: true,
    emptyMappingReason: "No durable KR mappings have been verified yet.",
    supportedActions: {
      ...WRITE_PROVIDER_ACTIONS,
      ...MAPPING_PROVIDER_ACTIONS,
    },
  },
  "yahoo-finance-au": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "Yahoo Finance AU does not use durable symbol mappings in this console.",
    supportedActions: WRITE_PROVIDER_ACTIONS,
  },
  "finmind-tw": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "FinMind TW has no provider-symbol mapping resolver yet.",
    supportedActions: WRITE_PROVIDER_ACTIONS,
  },
  "finmind-us": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "FinMind US has no provider-symbol mapping resolver yet.",
    supportedActions: WRITE_PROVIDER_ACTIONS,
  },
  "twelve-data-kr": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: false,
    supportsResolverModes: false,
    emptyMappingReason: "Twelve Data KR is catalog evidence for KR bindings; Yahoo KR owns the durable provider mapping.",
    supportedActions: {
      renew_evidence: "checkbox",
      purge_logs: "typed_preview",
      normalize_errors: "checkbox",
      refresh_health: "none",
    },
    disabledReasons: {
      repair_mapping: "Twelve Data KR supplies catalog evidence; Yahoo Finance KR owns durable repair mappings.",
      rerun_backfill: "Twelve Data free-plan KR bars are plan-limited, so rerun is not available through this provider.",
      reverify_mapping: "Twelve Data KR mappings are verified through Yahoo Finance KR.",
      revert_mapping: "Twelve Data KR does not own durable provider mappings.",
    },
  },
  "twelve-data-au": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: false,
    supportsResolverModes: false,
    emptyMappingReason: "Twelve Data AU is catalog metadata only in this console.",
    supportedActions: {
      renew_evidence: "checkbox",
      purge_logs: "typed_preview",
      normalize_errors: "checkbox",
      refresh_health: "none",
    },
    disabledReasons: {
      repair_mapping: "Twelve Data AU does not own durable provider-symbol mappings.",
      rerun_backfill: "Twelve Data AU is catalog metadata only; Yahoo Finance AU owns AU bar reruns.",
      reverify_mapping: "Twelve Data AU does not own durable provider-symbol mappings.",
      revert_mapping: "Twelve Data AU does not own durable provider-symbol mappings.",
    },
  },
  frankfurter: {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "Frankfurter refreshes FX rates and does not use symbol mappings.",
    supportedActions: WRITE_PROVIDER_ACTIONS,
  },
  "asx-gics-csv": {
    supportsMappings: false,
    supportsRepair: false,
    supportsRenew: true,
    supportsRerun: true,
    supportsResolverModes: false,
    emptyMappingReason: "ASX GICS CSV enriches catalog classifications and does not use provider-symbol mappings.",
    supportedActions: WRITE_PROVIDER_ACTIONS,
  },
};

function actionCapability(
  action: ProviderOperationAction,
  definition: ProviderCapabilityDefinition,
): ProviderOperationActionCapabilityDto {
  const guardrail = definition.supportedActions[action];
  if (guardrail) {
    return {
      action,
      supported: true,
      guardrail,
      reason: null,
    };
  }
  return {
    action,
    supported: false,
    guardrail: "none",
    reason: definition.disabledReasons?.[action] ?? DEFAULT_DISABLED_REASONS[action],
  };
}

export function getProviderOperationCapability(providerId: string): ProviderOperationCapabilityDto {
  const definition = PROVIDER_CAPABILITY_DEFINITIONS[providerId] ?? DEFAULT_DEFINITION;
  return {
    providerId,
    supportsMappings: definition.supportsMappings,
    supportsRepair: definition.supportsRepair,
    supportsRenew: definition.supportsRenew,
    supportsRerun: definition.supportsRerun,
    supportsResolverModes: definition.supportsResolverModes,
    emptyMappingReason: definition.emptyMappingReason,
    actions: PROVIDER_OPERATION_ACTIONS.map((action) => actionCapability(action, definition)),
  };
}

export function listProviderOperationCapabilities(providerIds: string[]): ProviderOperationCapabilityDto[] {
  return [...new Set(providerIds)].map((providerId) => getProviderOperationCapability(providerId));
}
