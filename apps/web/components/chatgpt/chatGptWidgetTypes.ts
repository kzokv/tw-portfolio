"use client";

import type { AccountDefaultCurrency, AccountType } from "@vakwen/shared-types";

export interface ChatGptWidgetAccountOption {
  id: string;
  name: string;
  defaultCurrency?: AccountDefaultCurrency | null;
  accountType?: AccountType | null;
  feeProfileName?: string | null;
  status?: "active" | "deleted" | string | null;
}

export interface ChatGptPostingPreviewRow {
  rowId: string;
  accountId?: string | null;
  accountName?: string | null;
  ticker: string;
  side: string;
  quantity?: number | null;
  unitPrice?: number | null;
  priceCurrency?: string | null;
  commissionAmount?: number | null;
  taxAmount?: number | null;
  feeSourceLabel?: string | null;
  netCashImpactAmount?: number | null;
  netCashImpactCurrency?: string | null;
  warnings?: string[];
}

export interface ChatGptPostingPreviewSummaryRow {
  accountId?: string | null;
  accountName?: string | null;
  currency: string;
  totalBuysAmount?: number | null;
  totalSellsAmount?: number | null;
  totalCommissionAmount?: number | null;
  totalTaxAmount?: number | null;
  netCashImpactAmount?: number | null;
}

export interface ChatGptPostingPreviewSection {
  title?: string | null;
  rows: ChatGptPostingPreviewRow[];
  summaryRows: ChatGptPostingPreviewSummaryRow[];
  warnings: string[];
}

export interface ChatGptAccountManagerWidgetAccount {
  id: string;
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
  feeProfileName?: string | null;
  status?: "active" | "deleted" | string | null;
  deletedAt?: string | null;
}

export interface ChatGptAccountManagerWidgetPayload {
  title: string;
  subtitle: string;
  activeAccounts: ChatGptAccountManagerWidgetAccount[];
  deletedAccounts: ChatGptAccountManagerWidgetAccount[];
  permissions: {
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canRestore: boolean;
    manageScopeGranted: boolean;
    requiresManageReconsent: boolean;
  };
  tools: {
    refresh: string | null;
    createAccount: string | null;
    updateAccount: string | null;
    deleteAccount: string | null;
    restoreAccount: string | null;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function unwrapWidgetRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.widget && typeof record.widget === "object") {
    return unwrapWidgetRecord(record.widget);
  }
  if (record.accountManager && typeof record.accountManager === "object") {
    return unwrapWidgetRecord(record.accountManager);
  }
  return record;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readAccountOptions(value: unknown): ChatGptWidgetAccountOption[] {
  const record = unwrapWidgetRecord(value);
  const source = Array.isArray(record?.accountOptions)
    ? record.accountOptions
    : Array.isArray(record?.accounts)
      ? record.accounts
      : [];
  return source.flatMap((item) => {
    const candidate = asRecord(item);
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.name !== "string") return [];
    return [{
      id: candidate.id,
      name: candidate.name,
      defaultCurrency: typeof candidate.defaultCurrency === "string" ? candidate.defaultCurrency as AccountDefaultCurrency : null,
      accountType: typeof candidate.accountType === "string" ? candidate.accountType as AccountType : null,
      feeProfileName: typeof candidate.feeProfileName === "string" ? candidate.feeProfileName : null,
      status: typeof candidate.status === "string" ? candidate.status : null,
    }];
  });
}

export function readPostingPreview(value: unknown): ChatGptPostingPreviewSection | null {
  const record = unwrapWidgetRecord(value);
  const preview = asRecord(record?.postingPreview);
  if (!preview) return null;
  const rowSource = Array.isArray(preview.rows) ? preview.rows : [];
  const summarySource = Array.isArray(preview.summaryRows)
    ? preview.summaryRows
    : Array.isArray(preview.aggregateSummary)
      ? preview.aggregateSummary
      : Array.isArray(preview.groups)
        ? preview.groups
      : [];
  return {
    title: typeof preview.title === "string" ? preview.title : null,
    rows: rowSource.flatMap((item) => {
      const candidate = asRecord(item);
      if (!candidate || typeof candidate.ticker !== "string") return [];
      return [{
        rowId: typeof candidate.rowId === "string" ? candidate.rowId : candidate.ticker,
        accountId: typeof candidate.accountId === "string" ? candidate.accountId : null,
        accountName: typeof candidate.accountName === "string" ? candidate.accountName : null,
        ticker: candidate.ticker,
        side: typeof candidate.side === "string"
          ? candidate.side
          : typeof candidate.type === "string"
            ? candidate.type
            : "-",
        quantity: typeof candidate.quantity === "number" ? candidate.quantity : null,
        unitPrice: typeof candidate.unitPrice === "number" ? candidate.unitPrice : null,
        priceCurrency: typeof candidate.priceCurrency === "string" ? candidate.priceCurrency : null,
        commissionAmount: typeof candidate.commissionAmount === "number" ? candidate.commissionAmount : null,
        taxAmount: typeof candidate.taxAmount === "number" ? candidate.taxAmount : null,
        feeSourceLabel: typeof candidate.feeSourceLabel === "string"
          ? candidate.feeSourceLabel
          : typeof candidate.feesSource === "string"
            ? candidate.feesSource.replace(/_/g, " ").toLowerCase()
            : null,
        netCashImpactAmount: typeof candidate.netCashImpactAmount === "number" ? candidate.netCashImpactAmount : null,
        netCashImpactCurrency: typeof candidate.netCashImpactCurrency === "string"
          ? candidate.netCashImpactCurrency
          : typeof candidate.priceCurrency === "string"
            ? candidate.priceCurrency
            : null,
        warnings: asStringArray(candidate.warnings),
      }];
    }),
    summaryRows: summarySource.flatMap((item) => {
      const candidate = asRecord(item);
      if (!candidate || typeof candidate.currency !== "string") return [];
      return [{
        accountId: typeof candidate.accountId === "string" ? candidate.accountId : null,
        accountName: typeof candidate.accountName === "string" ? candidate.accountName : null,
        currency: candidate.currency,
        totalBuysAmount: typeof candidate.totalBuysAmount === "number"
          ? candidate.totalBuysAmount
          : typeof candidate.totalGrossBuyAmount === "number"
            ? candidate.totalGrossBuyAmount
            : null,
        totalSellsAmount: typeof candidate.totalSellsAmount === "number"
          ? candidate.totalSellsAmount
          : typeof candidate.totalGrossSellAmount === "number"
            ? candidate.totalGrossSellAmount
            : null,
        totalCommissionAmount: typeof candidate.totalCommissionAmount === "number" ? candidate.totalCommissionAmount : null,
        totalTaxAmount: typeof candidate.totalTaxAmount === "number" ? candidate.totalTaxAmount : null,
        netCashImpactAmount: typeof candidate.netCashImpactAmount === "number" ? candidate.netCashImpactAmount : null,
      }];
    }),
    warnings: asStringArray(preview.warnings),
  };
}

export function readAccountManagerPayload(value: unknown): ChatGptAccountManagerWidgetPayload | null {
  const record = unwrapWidgetRecord(value);
  if (!record) return null;
  const activeSource = Array.isArray(record.activeAccounts)
    ? record.activeAccounts
    : Array.isArray(record.accounts)
      ? record.accounts
      : [];
  const deletedSource = Array.isArray(record.deletedAccounts) ? record.deletedAccounts : [];
  const permissions = asRecord(record.permissions);
  const tools = asRecord(record.tools);
  if (!permissions || !tools) return null;
  const parseAccount = (item: unknown): ChatGptAccountManagerWidgetAccount | null => {
    const candidate = asRecord(item);
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
    if (typeof candidate.defaultCurrency !== "string" || typeof candidate.accountType !== "string") return null;
    return {
      id: candidate.id,
      name: candidate.name,
      defaultCurrency: candidate.defaultCurrency as AccountDefaultCurrency,
      accountType: candidate.accountType as AccountType,
      feeProfileName: typeof candidate.feeProfileName === "string" ? candidate.feeProfileName : null,
      status: typeof candidate.status === "string" ? candidate.status : null,
      deletedAt: typeof candidate.deletedAt === "string" ? candidate.deletedAt : null,
    };
  };
  return {
    title: typeof record.title === "string" ? record.title : "Manage accounts",
    subtitle: typeof record.subtitle === "string" ? record.subtitle : "",
    activeAccounts: activeSource.flatMap((item) => {
      const parsed = parseAccount(item);
      return parsed ? [parsed] : [];
    }),
    deletedAccounts: deletedSource.flatMap((item) => {
      const parsed = parseAccount(item);
      return parsed ? [parsed] : [];
    }),
    permissions: {
      canCreate: permissions.canCreate === true,
      canEdit: permissions.canEdit === true,
      canDelete: permissions.canDelete === true || permissions.canSoftDelete === true,
      canRestore: permissions.canRestore === true,
      manageScopeGranted: permissions.manageScopeGranted === true,
      requiresManageReconsent: permissions.requiresManageReconsent === true
        || (permissions.adminWritePolicyEnabled === true && permissions.manageScopeGranted !== true),
    },
    tools: {
      refresh: typeof tools.refresh === "string" ? tools.refresh : null,
      createAccount: typeof tools.createAccount === "string" ? tools.createAccount : null,
      updateAccount: typeof tools.updateAccount === "string" ? tools.updateAccount : null,
      deleteAccount: typeof tools.deleteAccount === "string"
        ? tools.deleteAccount
        : typeof tools.softDeleteAccount === "string"
          ? tools.softDeleteAccount
          : null,
      restoreAccount: typeof tools.restoreAccount === "string" ? tools.restoreAccount : null,
    },
  };
}
