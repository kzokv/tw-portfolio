"use client";

import type { TransactionHistoryItemDto } from "@vakwen/shared-types";

type WithOptionalAccountName = { accountName?: string | null; accountId?: string | null };

export function accountDisplayName(value: WithOptionalAccountName): string {
  return value.accountName?.trim() || value.accountId?.trim() || "Unknown account";
}

export function transactionAccountDisplayName(transaction: TransactionHistoryItemDto): string {
  return accountDisplayName(transaction as TransactionHistoryItemDto & { accountName?: string | null });
}
