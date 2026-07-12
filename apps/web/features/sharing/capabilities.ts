import type { ShareCapability } from "@vakwen/shared-types";

export const DIVIDEND_WRITE_CAPABILITY = "dividend:write" as ShareCapability;

export interface SharedContextPermissions {
  canReadAiDrafts: boolean;
  canManageAccounts: boolean;
  canManageSharing: boolean;
  canWriteTransactions: boolean;
  canWriteDividends: boolean;
  canCreateDrafts: boolean;
  canEditDrafts: boolean;
  canArchiveDrafts: boolean;
  canDeleteDrafts: boolean;
  hasAnyDelegatedWrite: boolean;
}

export const ASSIGNABLE_SHARE_CAPABILITIES: ShareCapability[] = [
  "portfolio:mcp_read",
  "account:manage",
  "sharing:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
  DIVIDEND_WRITE_CAPABILITY,
];

export function deriveSharedContextPermissions(
  capabilities: readonly ShareCapability[],
): SharedContextPermissions {
  const set = new Set(capabilities);
  const canReadAiDrafts = set.has("portfolio:mcp_read");
  const canManageAccounts = set.has("account:manage");
  const canManageSharing = set.has("sharing:manage");
  const canWriteTransactions = set.has("transaction:write");
  const canWriteDividends = set.has(DIVIDEND_WRITE_CAPABILITY);
  const canCreateDrafts = set.has("transaction_draft:create");
  const canEditDrafts = set.has("transaction_draft:edit");
  const canArchiveDrafts = set.has("transaction_draft:archive");
  const canDeleteDrafts = set.has("transaction_draft:delete");

  return {
    canReadAiDrafts,
    canManageAccounts,
    canManageSharing,
    canWriteTransactions,
    canWriteDividends,
    canCreateDrafts,
    canEditDrafts,
    canArchiveDrafts,
    canDeleteDrafts,
    hasAnyDelegatedWrite:
      canManageAccounts
      || canManageSharing
      || canWriteTransactions
      || canWriteDividends
      || canCreateDrafts
      || canEditDrafts
      || canArchiveDrafts
      || canDeleteDrafts,
  };
}
