import { getJson } from "../../../lib/api";
import type { ShellPortfolioConfigDto } from "@vakwen/shared-types";

export type { ShellPortfolioConfigDto };

export async function fetchShellPortfolioConfig(): Promise<ShellPortfolioConfigDto> {
  return getJson<ShellPortfolioConfigDto>("/settings/fee-config");
}
