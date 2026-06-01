"use client";

import type { ChatGptAccountManagerWidgetPayload } from "./chatGptWidgetTypes";

export function buildMockAccountManagerWidgetData(): ChatGptAccountManagerWidgetPayload {
  return {
    title: "Manage brokerage accounts",
    subtitle: "Create, rename, archive, and restore the accounts that ChatGPT can target when drafting transactions.",
    activeAccounts: [
      {
        id: "acct-tw",
        name: "Cathay TW Brokerage",
        defaultCurrency: "TWD",
        accountType: "broker",
        feeProfileName: "TW Equity Default",
        status: "active",
      },
      {
        id: "acct-us",
        name: "USD Brokerage",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileName: "US Equity Default",
        status: "active",
      },
      {
        id: "acct-wallet",
        name: "Cash Wallet",
        defaultCurrency: "USD",
        accountType: "wallet",
        feeProfileName: "Cash Wallet Fees",
        status: "active",
      },
    ],
    deletedAccounts: [
      {
        id: "acct-demo",
        name: "Demo Brokerage",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileName: "US Equity Default",
        status: "deleted",
        deletedAt: "2026-05-30T09:15:00.000Z",
      },
    ],
    permissions: {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canRestore: true,
      manageScopeGranted: true,
      requiresManageReconsent: false,
    },
    tools: {
      refresh: "get_account_manager_component",
      createAccount: "create_account",
      updateAccount: "update_account",
      deleteAccount: "soft_delete_account",
      restoreAccount: "restore_account",
    },
  };
}
