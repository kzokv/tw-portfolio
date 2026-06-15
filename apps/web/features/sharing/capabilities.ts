import type { ShareCapability } from "@vakwen/shared-types";

export interface SharedContextPermissions {
  canReadAiDrafts: boolean;
  canManageAccounts: boolean;
  canWriteTransactions: boolean;
  canCreateDrafts: boolean;
  canEditDrafts: boolean;
  canArchiveDrafts: boolean;
  canDeleteDrafts: boolean;
  hasAnyDelegatedWrite: boolean;
}

export const ASSIGNABLE_SHARE_CAPABILITIES: ShareCapability[] = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
];

export function deriveSharedContextPermissions(
  capabilities: readonly ShareCapability[],
): SharedContextPermissions {
  const set = new Set(capabilities);
  const canReadAiDrafts = set.has("portfolio:mcp_read");
  const canManageAccounts = set.has("account:manage");
  const canWriteTransactions = set.has("transaction:write");
  const canCreateDrafts = set.has("transaction_draft:create");
  const canEditDrafts = set.has("transaction_draft:edit");
  const canArchiveDrafts = set.has("transaction_draft:archive");
  const canDeleteDrafts = set.has("transaction_draft:delete");

  return {
    canReadAiDrafts,
    canManageAccounts,
    canWriteTransactions,
    canCreateDrafts,
    canEditDrafts,
    canArchiveDrafts,
    canDeleteDrafts,
    hasAnyDelegatedWrite:
      canManageAccounts
      || canWriteTransactions
      || canCreateDrafts
      || canEditDrafts
      || canArchiveDrafts
      || canDeleteDrafts,
  };
}
