"use client";

import { Plus, Trash2 } from "lucide-react";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import type { SettingsProfileModel } from "../types/settingsUi";

interface FeeProfilesSectionProps {
  profiles: SettingsProfileModel[];
  onAddProfile: () => void;
  onRemoveProfile: (profileId: string) => void;
  onUpdateProfileField: (profileId: string, key: keyof SettingsProfileModel, value: string | number) => void;
  dict: AppDictionary;
}

const PROFILE_FIELDS: Array<{
  key: keyof SettingsProfileModel;
  label: keyof AppDictionary["settings"];
  min?: number;
}> = [
  { key: "commissionRateBps", label: "profileCommissionLabel", min: 0 },
  { key: "commissionDiscountBps", label: "profileDiscountLabel", min: 1 },
  { key: "minCommissionNtd", label: "profileMinCommissionLabel", min: 0 },
  { key: "stockSellTaxRateBps", label: "profileStockTaxLabel", min: 0 },
  { key: "stockDayTradeTaxRateBps", label: "profileDayTradeTaxLabel", min: 0 },
  { key: "etfSellTaxRateBps", label: "profileEtfTaxLabel", min: 0 },
  { key: "bondEtfSellTaxRateBps", label: "profileBondEtfTaxLabel", min: 0 },
];

export function FeeProfilesSection({
  profiles,
  onAddProfile,
  onRemoveProfile,
  onUpdateProfileField,
  dict,
}: FeeProfilesSectionProps) {
  return (
    <section className="glass-inset space-y-3 rounded-[24px] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">{dict.settings.profileSectionTitle}</h3>
          <p className="text-xs text-slate-400">{dict.settings.profileSectionDescription}</p>
        </div>
        <Button type="button" size="sm" onClick={onAddProfile} data-testid="settings-add-profile-button">
          <Plus className="mr-1 h-3.5 w-3.5" />
          {dict.actions.addProfile}
        </Button>
      </div>

      <div className="space-y-4">
        {profiles.map((profile, index) => (
          <article
            key={profile.id}
            className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4"
            data-testid={`settings-profile-card-${index}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">
                {dict.settings.profileCardTitle} {index + 1}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveProfile(profile.id)}
                data-testid={`settings-remove-profile-${index}`}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {dict.actions.remove}
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-2 text-xs text-slate-400">
                {dict.settings.profileNameLabel}
                <input
                  value={profile.name}
                  onChange={(event) => onUpdateProfileField(profile.id, "name", event.target.value)}
                  className={fieldClassName}
                  data-testid={`settings-profile-name-${index}`}
                />
              </label>

              {PROFILE_FIELDS.map((field) => (
                <label key={field.key} className="space-y-2 text-xs text-slate-400">
                  {dict.settings[field.label]}
                  <input
                    type="number"
                    min={field.min}
                    value={profile[field.key] as number}
                    onChange={(event) => onUpdateProfileField(profile.id, field.key, Number(event.target.value) || 0)}
                    className={fieldClassName}
                  />
                </label>
              ))}

              <label className="space-y-2 text-xs text-slate-400">
                {dict.settings.profileCommissionRoundLabel}
                <select
                  value={profile.commissionRoundingMode}
                  onChange={(event) => onUpdateProfileField(profile.id, "commissionRoundingMode", event.target.value)}
                  className={fieldClassName}
                >
                  <option value="FLOOR">FLOOR</option>
                  <option value="ROUND">ROUND</option>
                  <option value="CEIL">CEIL</option>
                </select>
              </label>

              <label className="space-y-2 text-xs text-slate-400">
                {dict.settings.profileTaxRoundLabel}
                <select
                  value={profile.taxRoundingMode}
                  onChange={(event) => onUpdateProfileField(profile.id, "taxRoundingMode", event.target.value)}
                  className={fieldClassName}
                >
                  <option value="FLOOR">FLOOR</option>
                  <option value="ROUND">ROUND</option>
                  <option value="CEIL">CEIL</option>
                </select>
              </label>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
