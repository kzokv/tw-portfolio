import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import { patchJson, putJson } from "../../../lib/api";
import type { SaveSettingsRequest } from "../types/settingsUi";

export interface SaveSettingsResponse {
  settings: UserSettings;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
}

export async function renameAccount(accountId: string, name: string): Promise<AccountDto> {
  return patchJson<AccountDto>(`/accounts/${encodeURIComponent(accountId)}`, { name });
}

export async function saveFullSettings(request: SaveSettingsRequest): Promise<SaveSettingsResponse> {
  return putJson<SaveSettingsResponse>("/settings/full", request);
}
