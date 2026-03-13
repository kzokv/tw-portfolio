import type {
  AccountDto,
  DashboardOverviewDto,
  DashboardOverviewHoldingDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  UserSettings,
} from "@tw-portfolio/shared-types";
import type { TransactionInput } from "../../components/portfolio/types";

export interface DashboardSnapshot extends Omit<DashboardOverviewDto, "settings"> {
  settings: UserSettings | null;
}

export type IntegrityIssue = NonNullable<DashboardOverviewDto["actions"]["integrityIssue"]>;

export interface DashboardState extends DashboardSnapshot {
  isBootstrapping: boolean;
  isRefreshing: boolean;
  errorMessage: string;
}

export function resolveTransactionDraftAccount(
  previous: TransactionInput,
  accounts: AccountDto[],
  feeProfiles: FeeProfileDto[],
  feeProfileBindings: FeeProfileBindingDto[],
): TransactionInput {
  const defaultAccountId = accounts[0]?.id ?? "";
  const nextAccountId = accounts.some((account) => account.id === previous.accountId)
    ? previous.accountId
    : defaultAccountId;

  if (!nextAccountId) {
    return previous;
  }

  const normalizedSymbol = previous.symbol.trim().toUpperCase();
  const matchingBinding = feeProfileBindings.find((binding) =>
    binding.accountId === nextAccountId && binding.symbol.trim().toUpperCase() === normalizedSymbol
  );
  const accountProfileId = accounts.find((account) => account.id === nextAccountId)?.feeProfileId ?? "";
  const effectiveProfileId = matchingBinding?.feeProfileId ?? accountProfileId;
  const effectiveCurrency = feeProfiles.find((profile) => profile.id === effectiveProfileId)?.commissionCurrency ?? previous.priceCurrency;

  if (nextAccountId === previous.accountId && effectiveCurrency === previous.priceCurrency) {
    return previous;
  }

  return {
    ...previous,
    accountId: nextAccountId,
    priceCurrency: effectiveCurrency,
  };
}

export function summarizeLargestHolding(holdings: DashboardOverviewHoldingDto[]): DashboardOverviewHoldingDto | null {
  return holdings[0] ?? null;
}
