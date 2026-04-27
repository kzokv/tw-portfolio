import type { AccountDefaultCurrency, AccountType } from "@tw-portfolio/shared-types";

/**
 * KZO-167: pure helper that formats an account dropdown / summary chip
 * label as `"${name} (${defaultCurrency} · ${typeLabel})"`. Lives outside
 * the React component (and outside the i18n dictionary) to satisfy
 * `.claude/rules/nextjs-i18n-serialization.md` — function values cannot
 * cross the Next.js server→client boundary inside a dictionary, so the
 * dispatcher must live in regular module code.
 *
 * The label dispatch consumes a flat record of the three localized strings
 * rather than the full `AppDictionary` so the helper stays trivially
 * unit-testable from `apps/web/test/features/cash-ledger/accountOptions.test.ts`.
 */
export interface AccountOptionInput {
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
}

export interface AccountTypeLabels {
  accountTypeBroker: string;
  accountTypeBank: string;
  accountTypeWallet: string;
}

export function accountTypeLabel(accountType: AccountType, labels: AccountTypeLabels): string {
  switch (accountType) {
    case "broker": return labels.accountTypeBroker;
    case "bank": return labels.accountTypeBank;
    case "wallet": return labels.accountTypeWallet;
  }
}

export function formatAccountOption(account: AccountOptionInput, labels: AccountTypeLabels): string {
  return `${account.name} (${account.defaultCurrency} · ${accountTypeLabel(account.accountType, labels)})`;
}
