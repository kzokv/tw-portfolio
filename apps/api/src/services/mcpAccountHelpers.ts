import type { AccountDto, McpAccountDisplayDto } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";

const UNAVAILABLE_ACCOUNT_LABEL_PREFIX = "Deleted or missing account";

export function resolveAccountDisplayName(
  accountById: ReadonlyMap<string, Pick<AccountDto, "id" | "name">>,
  accountId: string,
): string {
  return accountById.get(accountId)?.name ?? `${UNAVAILABLE_ACCOUNT_LABEL_PREFIX} (${accountId})`;
}

export function toMcpAccountDisplayDto(
  account: AccountDto & { deletedAt?: string | null },
  feeProfileName: string | null,
  liveBalance: McpAccountDisplayDto["liveBalance"] = [],
): McpAccountDisplayDto {
  return {
    id: account.id,
    name: account.name,
    defaultCurrency: account.defaultCurrency,
    accountType: account.accountType,
    feeProfileId: account.feeProfileId,
    feeProfileName,
    status: account.deletedAt ? "deleted" : "active",
    deletedAt: account.deletedAt ?? null,
    liveBalance,
  };
}

export function resolveUniqueActiveAccount(
  accounts: AccountDto[],
  input: { accountId?: string | null; accountName?: string | null },
): AccountDto {
  const accountId = input.accountId?.trim() ?? "";
  if (accountId) {
    const exact = accounts.find((account) => account.id === accountId);
    if (!exact) {
      throw routeError(404, "mcp_account_not_found", `Active account ${accountId} was not found`);
    }
    return exact;
  }

  const accountName = input.accountName?.trim() ?? "";
  if (!accountName) {
    throw routeError(400, "mcp_account_reference_required", "accountId or accountName is required");
  }

  const matches = accounts.filter((account) => account.name.trim().toLowerCase() === accountName.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw routeError(404, "mcp_account_not_found", `Active account named ${accountName} was not found`);
  }
  const candidateNames = matches.map((account) => `${account.name} (${account.id})`).join(", ");
  throw routeError(
    409,
    "mcp_account_name_ambiguous",
    `Account name ${accountName} matched multiple active accounts: ${candidateNames}`,
  );
}
