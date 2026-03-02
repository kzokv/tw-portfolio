import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import { getJson } from "../../../lib/api";
import type { Holding } from "../../../components/portfolio/types";
import type { DashboardSnapshot, IntegrityIssue } from "../types";

interface FeeConfigResponse {
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  integrityIssue: IntegrityIssue | null;
}

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [settings, holdings, feeConfig] = await Promise.all([
    getJson<UserSettings>("/settings"),
    getJson<Holding[]>("/portfolio/holdings"),
    getJson<FeeConfigResponse>("/settings/fee-config"),
  ]);

  return {
    settings,
    holdings,
    accounts: feeConfig.accounts,
    feeProfiles: feeConfig.feeProfiles,
    feeProfileBindings: feeConfig.feeProfileBindings,
    integrityIssue: feeConfig.integrityIssue,
  };
}
