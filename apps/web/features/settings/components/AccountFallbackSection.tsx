"use client";

import type { AccountDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import type { SettingsAccountBindingModel, SettingsProfileModel } from "../types/settingsUi";

interface AccountFallbackSectionProps {
  accounts: AccountDto[];
  bindings: SettingsAccountBindingModel[];
  profiles: SettingsProfileModel[];
  onUpdateAccountProfile: (accountId: string, feeProfileId: string) => void;
  dict: AppDictionary;
}

export function AccountFallbackSection({
  accounts,
  bindings,
  profiles,
  onUpdateAccountProfile,
  dict,
}: AccountFallbackSectionProps) {
  return (
    <section className="glass-inset space-y-3 rounded-[24px] p-4">
      <h3 className="text-lg font-semibold text-ink">{dict.settings.accountFallbackSectionTitle}</h3>
      <p className="text-xs text-slate-400">{dict.settings.accountFallbackSectionDescription}</p>

      <div className="space-y-2">
        {accounts.map((account) => {
          const draftAccount = bindings.find((item) => item.id === account.id);
          return (
            <div key={account.id} className="grid gap-3 rounded-[18px] border border-white/10 bg-slate-950/35 p-3 text-sm lg:grid-cols-[1fr_220px]">
              <div>
                <p className="font-medium text-ink">{account.name}</p>
                <p className="text-xs text-slate-400">{account.id}</p>
              </div>
              <select
                value={draftAccount?.feeProfileId ?? ""}
                onChange={(event) => onUpdateAccountProfile(account.id, event.target.value)}
                className={fieldClassName}
                data-testid={`settings-account-profile-${account.id}`}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}
