"use client";

import { Plus, Trash2 } from "lucide-react";
import type { AccountDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import type { SettingsProfileModel, SettingsSecurityBindingModel } from "../types/settingsUi";

interface SecurityBindingsSectionProps {
  accounts: AccountDto[];
  profiles: SettingsProfileModel[];
  bindings: SettingsSecurityBindingModel[];
  onAddBinding: () => void;
  onUpdateBinding: (index: number, patch: Partial<SettingsSecurityBindingModel>) => void;
  onRemoveBinding: (index: number) => void;
  dict: AppDictionary;
}

export function SecurityBindingsSection({
  accounts,
  profiles,
  bindings,
  onAddBinding,
  onUpdateBinding,
  onRemoveBinding,
  dict,
}: SecurityBindingsSectionProps) {
  return (
    <section className="glass-inset space-y-3 rounded-[24px] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">{dict.settings.bindingSectionTitle}</h3>
          <p className="text-xs text-slate-400">{dict.settings.bindingSectionDescription}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAddBinding} data-testid="settings-add-binding-button">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {dict.actions.addOverride}
        </Button>
      </div>

      {bindings.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-white/15 bg-slate-950/35 px-3 py-3 text-xs text-slate-400">
          {dict.settings.bindingEmptyState}
        </p>
      ) : (
        <div className="space-y-2">
          {bindings.map((binding, index) => (
            <div
              key={`${binding.accountId}-${binding.symbol}-${index}`}
              className="grid gap-3 rounded-[18px] border border-white/10 bg-slate-950/35 p-3 lg:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto]"
              data-testid={`settings-binding-row-${index}`}
            >
              <select
                value={binding.accountId}
                onChange={(event) => onUpdateBinding(index, { accountId: event.target.value })}
                className={fieldClassName}
                data-testid={`settings-binding-account-${index}`}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.id})
                  </option>
                ))}
              </select>

              <input
                value={binding.symbol}
                onChange={(event) => onUpdateBinding(index, { symbol: event.target.value.toUpperCase() })}
                className={fieldClassName}
                maxLength={16}
                placeholder="2330"
                data-testid={`settings-binding-symbol-${index}`}
              />

              <select
                value={binding.feeProfileId}
                onChange={(event) => onUpdateBinding(index, { feeProfileId: event.target.value })}
                className={fieldClassName}
                data-testid={`settings-binding-profile-${index}`}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveBinding(index)}
                data-testid={`settings-remove-binding-${index}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
