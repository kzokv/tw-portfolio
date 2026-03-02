import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import type { Holding, TransactionInput } from "../../components/portfolio/types";

export interface IntegrityIssue {
  code: string;
  message: string;
}

export interface DashboardSnapshot {
  settings: UserSettings | null;
  holdings: Holding[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  integrityIssue: IntegrityIssue | null;
}

export interface DashboardState extends DashboardSnapshot {
  isBootstrapping: boolean;
  isRefreshing: boolean;
  errorMessage: string;
}

export function resolveTransactionDraftAccount(
  previous: TransactionInput,
  accounts: AccountDto[],
): TransactionInput {
  const defaultAccountId = accounts[0]?.id ?? "";

  return {
    ...previous,
    accountId: accounts.some((account) => account.id === previous.accountId)
      ? previous.accountId
      : defaultAccountId,
  };
}
