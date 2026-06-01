import { getJson } from "../../../lib/api";
import type { IntegrityIssue } from "../../dashboard/types";
import type {
  AccountDto,
  FeeProfileBindingDto,
  FeeProfileDto,
} from "@vakwen/shared-types";

export interface ShellPortfolioConfigDto {
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  integrityIssue: IntegrityIssue | null;
}

export async function fetchShellPortfolioConfig(): Promise<ShellPortfolioConfigDto> {
  return getJson<ShellPortfolioConfigDto>("/settings/fee-config");
}
