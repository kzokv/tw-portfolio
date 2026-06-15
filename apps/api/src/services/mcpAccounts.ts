import { randomUUID } from "node:crypto";
import { roundToDecimal } from "@vakwen/domain";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountType,
  ChatGptAccountManagerWidgetDto,
  McpAccountDisplayDto,
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import type { McpDraftServiceDeps } from "../mcp/types.js";
import { isUniqueViolation } from "../persistence/postgres.js";
import type { Store } from "../types/store.js";
import { resolveUniqueActiveAccount } from "./mcpAccountHelpers.js";
import { createDefaultFeeProfile } from "./store.js";
import { syncAccountingPolicy } from "./accountingStore.js";
import { connectorGroupForScope } from "./mcpConnectorLifecycle.js";

interface AccountMutationAudit {
  actorUserId: string;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
}

async function appendDelegatedAccountWriteAudit(
  deps: McpDraftServiceDeps,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { shareId, portfolioContextUserId } = deps.requestContext.resolvedContext;
  if (!shareId) {
    return;
  }
  try {
    await deps.app.persistence.appendAuditLog({
      actorUserId: deps.requestContext.auth.sessionUserId,
      action: "delegated_portfolio_write",
      targetUserId: portfolioContextUserId,
      ipAddress: deps.requestContext.sourceIp,
      metadata: {
        ...metadata,
        delegatedByUserId: deps.requestContext.auth.sessionUserId,
        ownerUserId: portfolioContextUserId,
        contextUserId: portfolioContextUserId,
        shareId,
        source: "mcp_tool",
      },
    });
  } catch (error) {
    deps.requestContext.logger?.error(
      { error, action: "delegated_portfolio_write", metadata },
      "delegated account write audit append failed",
    );
  }
}

function buildLiveBalancesByAccount(store: Store): Map<string, Array<{ currency: string; amount: number }>> {
  const reversedIds = new Set<string>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) {
      reversedIds.add(entry.reversalOfCashLedgerEntryId);
    }
  }

  const balances = new Map<string, Map<string, number>>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) continue;
    if (reversedIds.has(entry.id)) continue;
    const currencyMap = balances.get(entry.accountId) ?? new Map<string, number>();
    currencyMap.set(entry.currency, (currencyMap.get(entry.currency) ?? 0) + entry.amount);
    balances.set(entry.accountId, currencyMap);
  }

  const result = new Map<string, Array<{ currency: string; amount: number }>>();
  for (const [accountId, currencyMap] of balances.entries()) {
    result.set(
      accountId,
      [...currencyMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({ currency, amount: roundToDecimal(amount, 2) })),
    );
  }
  return result;
}

async function loadAccountStore(deps: McpDraftServiceDeps) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const store = await deps.app.persistence.loadStore(contextUserId);
  syncAccountingPolicy(store);
  return { store, contextUserId };
}

function toAccountDisplay(
  store: Store,
  account: AccountDto & { deletedAt?: string | null },
  balancesByAccount: Map<string, Array<{ currency: string; amount: number }>>,
): McpAccountDisplayDto {
  const profile = store.feeProfiles.find((item) => item.id === account.feeProfileId) ?? null;
  return {
    id: account.id,
    name: account.name,
    defaultCurrency: account.defaultCurrency,
    accountType: account.accountType,
    feeProfileId: account.feeProfileId,
    feeProfileName: profile?.name ?? null,
    status: account.deletedAt ? "deleted" : "active",
    deletedAt: account.deletedAt ?? null,
    liveBalance: account.deletedAt ? [] : balancesByAccount.get(account.id) ?? [],
  };
}

export async function listMcpAccountDisplays(
  deps: McpDraftServiceDeps,
  input: { includeDeleted?: boolean } = {},
): Promise<{ accounts: McpAccountDisplayDto[]; deletedAccounts: McpAccountDisplayDto[] }> {
  const { store, contextUserId } = await loadAccountStore(deps);
  const balancesByAccount = buildLiveBalancesByAccount(store);
  const accounts = store.accounts
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((account) => toAccountDisplay(store, account, balancesByAccount));
  const deletedAccounts = input.includeDeleted
    ? (await deps.app.persistence.listSoftDeletedAccounts(contextUserId))
      .map((account) => toAccountDisplay(store, account, balancesByAccount))
    : [];
  return { accounts, deletedAccounts };
}

function accountSuggestions(accounts: McpAccountDisplayDto[], deletedAccounts: McpAccountDisplayDto[]): string[] {
  const suggestions: string[] = [];
  if (accounts.length === 0) suggestions.push("Create an account before drafting or posting transactions.");
  if (deletedAccounts.length > 0) suggestions.push("Recently deleted accounts can be restored before posting attached transactions.");
  const duplicateNames = new Set<string>();
  const seen = new Set<string>();
  for (const account of accounts) {
    const key = account.name.trim().toLowerCase();
    if (seen.has(key)) duplicateNames.add(account.name);
    seen.add(key);
  }
  for (const name of duplicateNames) {
    suggestions.push(`Rename duplicate account "${name}" to keep MCP account-name resolution unambiguous.`);
  }
  return suggestions;
}

const ACCOUNT_MANAGER_TOOLS = {
  refresh: "get_account_manager_component",
  createAccount: "create_account",
  updateAccount: "update_account",
  softDeleteAccount: "soft_delete_account",
  restoreAccount: "restore_account",
} as const;

function canUseAccountManageScope(deps: McpDraftServiceDeps, settings: { groupToggles: Record<"read" | "drafts" | "write", boolean> }): boolean {
  if (!settings.groupToggles[connectorGroupForScope("account:manage")]) return false;
  if (!deps.requestContext.auth.scopes.includes("account:manage")) return false;
  const { shareId, shareCapabilities } = deps.requestContext.resolvedContext;
  return !shareId || shareCapabilities.includes("account:manage");
}

function canUseAccountTool(deps: McpDraftServiceDeps, toolName: string, canUseManageScope: boolean): boolean {
  return canUseManageScope && deps.requestContext.auth.toolToggles[toolName] !== false;
}

export async function getAccountManagerComponent(
  deps: McpDraftServiceDeps,
): Promise<{ widget: ChatGptAccountManagerWidgetDto; _meta: Record<string, unknown> }> {
  const settings = await deps.app.persistence.getAiConnectorPolicySettings();
  const { accounts, deletedAccounts } = await listMcpAccountDisplays(deps, { includeDeleted: true });
  const canManage = canUseAccountManageScope(deps, settings);
  const permissions = {
    canCreate: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.createAccount, canManage),
    canEdit: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.updateAccount, canManage),
    canSoftDelete: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.softDeleteAccount, canManage),
    canRestore: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.restoreAccount, canManage),
    manageScopeGranted: deps.requestContext.auth.scopes.includes("account:manage"),
    adminWritePolicyEnabled: settings.groupToggles.write,
  };
  const widget: ChatGptAccountManagerWidgetDto = {
    title: "Manage accounts",
    subtitle: "Create, edit, soft-delete, and restore portfolio accounts through MCP tools.",
    accounts,
    deletedAccounts,
    permissions,
    suggestions: accountSuggestions(accounts, deletedAccounts),
    tools: {
      refresh: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.refresh, canManage) ? ACCOUNT_MANAGER_TOOLS.refresh : null,
      createAccount: permissions.canCreate ? ACCOUNT_MANAGER_TOOLS.createAccount : null,
      updateAccount: permissions.canEdit ? ACCOUNT_MANAGER_TOOLS.updateAccount : null,
      softDeleteAccount: permissions.canSoftDelete ? ACCOUNT_MANAGER_TOOLS.softDeleteAccount : null,
      restoreAccount: permissions.canRestore ? ACCOUNT_MANAGER_TOOLS.restoreAccount : null,
    },
  };
  return {
    widget,
    _meta: {
      widget,
      "openai/outputTemplate": `${deps.app.appBaseUrl}/connectors/chatgpt/account-manager`,
      "openai/widgetAccessible": true,
    },
  };
}

export async function listAccounts(
  deps: McpDraftServiceDeps,
  input: { includeDeleted?: boolean } = {},
) {
  return listMcpAccountDisplays(deps, input);
}

export async function createAccount(
  deps: McpDraftServiceDeps,
  input: { name: string; defaultCurrency: AccountDefaultCurrency; accountType: AccountType },
) {
  const { store } = await loadAccountStore(deps);
  const name = input.name.trim();
  if (store.accounts.some((account) => account.name === name)) {
    throw routeError(409, "account_name_in_use", "An account with that name already exists.");
  }
  const accountId = randomUUID();
  const seededProfile = createDefaultFeeProfile(accountId, input.defaultCurrency);
  const account: AccountDto = {
    id: accountId,
    userId: store.userId,
    name,
    feeProfileId: seededProfile.id,
    defaultCurrency: input.defaultCurrency,
    accountType: input.accountType,
  };
  store.feeProfiles.push(seededProfile);
  store.accounts.push(account);
  try {
    await deps.app.persistence.saveStore(store);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw routeError(409, "account_name_in_use", "An account with that name already exists.");
    }
    throw error;
  }
  await appendDelegatedAccountWriteAudit(deps, {
    mutation: "account_created",
    toolName: ACCOUNT_MANAGER_TOOLS.createAccount,
    accountId: account.id,
  });
  return { account };
}

export async function updateAccount(
  deps: McpDraftServiceDeps,
  input: { accountId?: string | null; accountName?: string | null; name?: string; feeProfileId?: string; accountType?: AccountType },
) {
  const { store } = await loadAccountStore(deps);
  const account = resolveUniqueActiveAccount(store.accounts, input);
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (store.accounts.some((item) => item.id !== account.id && item.name === name)) {
      throw routeError(409, "account_name_in_use", "An account with that name already exists.");
    }
    account.name = name;
  }
  if (input.feeProfileId !== undefined) {
    const profile = store.feeProfiles.find((item) => item.id === input.feeProfileId);
    if (!profile) throw routeError(404, "fee_profile_not_found", `Fee profile ${input.feeProfileId} was not found.`);
    if (profile.accountId !== account.id) {
      throw routeError(400, "invalid_fee_profile", `Fee profile ${input.feeProfileId} is not owned by account ${account.id}.`);
    }
    account.feeProfileId = input.feeProfileId;
  }
  if (input.accountType !== undefined) {
    account.accountType = input.accountType;
  }
  await deps.app.persistence.saveStore(store);
  await appendDelegatedAccountWriteAudit(deps, {
    mutation: "account_updated",
    toolName: ACCOUNT_MANAGER_TOOLS.updateAccount,
    accountId: account.id,
    changedFields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
  });
  return { account };
}

function auditForMutation(deps: McpDraftServiceDeps): AccountMutationAudit {
  const { shareId, portfolioContextUserId } = deps.requestContext.resolvedContext;
  return {
    actorUserId: deps.requestContext.auth.sessionUserId,
    ipAddress: deps.requestContext.sourceIp,
    metadata: {
      source: "mcp_tool",
      ...(shareId
        ? {
            delegatedByUserId: deps.requestContext.auth.sessionUserId,
            ownerUserId: portfolioContextUserId,
            contextUserId: portfolioContextUserId,
            shareId,
          }
        : {}),
    },
  };
}

export async function softDeleteAccount(
  deps: McpDraftServiceDeps,
  input: { accountId?: string | null; accountName?: string | null },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const { store } = await loadAccountStore(deps);
  const account = resolveUniqueActiveAccount(store.accounts, input);
  const { deletedAt } = await deps.app.persistence.softDeleteAccount(account.id, contextUserId, auditForMutation(deps));
  await deps.app.eventBus.publishEvent(contextUserId, "account_soft_deleted", {
    type: "account_soft_deleted" as const,
    accountId: account.id,
    deletedAt,
  });
  return { accountId: account.id, accountName: account.name, deletedAt };
}

export async function restoreAccount(
  deps: McpDraftServiceDeps,
  input: { accountId: string },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const { finalName } = await deps.app.persistence.restoreAccount(input.accountId, contextUserId, auditForMutation(deps));
  await deps.app.eventBus.publishEvent(contextUserId, "account_restored", {
    type: "account_restored" as const,
    accountId: input.accountId,
    finalName,
  });
  return { accountId: input.accountId, finalName };
}
