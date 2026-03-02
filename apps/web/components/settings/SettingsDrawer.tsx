"use client";

import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import type { FormEvent } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { GeneralSettingsSection } from "../../features/settings/components/GeneralSettingsSection";
import { FeeProfilesSection } from "../../features/settings/components/FeeProfilesSection";
import { AccountFallbackSection } from "../../features/settings/components/AccountFallbackSection";
import { SecurityBindingsSection } from "../../features/settings/components/SecurityBindingsSection";
import { SettingsDrawerShell } from "../../features/settings/components/SettingsDrawerShell";
import { UnsavedChangesFooter } from "../../features/settings/components/UnsavedChangesFooter";
import { useSettingsForm } from "../../features/settings/hooks/useSettingsForm";
import type { SettingsFormModel } from "../../features/settings/types/settingsUi";

export type SettingsDraft = SettingsFormModel;

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UserSettings | null;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  isSaving: boolean;
  errorMessage: string;
  onSave: (draft: SettingsDraft) => Promise<void>;
  dict: AppDictionary;
}

export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  accounts,
  feeProfiles,
  feeProfileBindings,
  isSaving,
  errorMessage,
  onSave,
  dict,
}: SettingsDrawerProps) {
  const form = useSettingsForm({
    open,
    settings,
    accounts,
    feeProfiles,
    feeProfileBindings,
    dict,
    onOpenChange,
    onSave,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.handleSubmit();
  }

  return (
    <SettingsDrawerShell open={open} onOpenChange={form.handleOpenChange} dict={dict}>
      {!form.draft ? (
        <p className="text-sm text-slate-300">{dict.feedback.loadingSettings}</p>
      ) : (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="mb-3 flex gap-2 md:mb-4">
            <Button
              type="button"
              variant={form.tab === "general" ? "default" : "secondary"}
              onClick={() => form.setTab("general")}
              data-testid="settings-tab-general"
            >
              {dict.settings.tabGeneral}
            </Button>
            <Button
              type="button"
              variant={form.tab === "fees" ? "default" : "secondary"}
              onClick={() => form.setTab("fees")}
              data-testid="settings-tab-fees"
            >
              {dict.settings.tabFeeProfiles}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
              {form.tab === "general" && (
                <GeneralSettingsSection
                  locale={form.draft.locale}
                  costBasisMethod={form.draft.costBasisMethod}
                  quotePollInterval={form.quotePollInterval}
                  onLocaleChange={(locale) => form.updateField("locale", locale)}
                  onCostBasisChange={(costBasisMethod) => form.updateField("costBasisMethod", costBasisMethod)}
                  onQuotePollIntervalChange={form.setQuotePollInterval}
                  dict={dict}
                />
              )}

              {form.tab === "fees" && (
                <>
                  <FeeProfilesSection
                    profiles={form.draft.feeProfiles}
                    onAddProfile={form.addProfile}
                    onRemoveProfile={form.removeProfile}
                    onUpdateProfileField={form.updateProfileField}
                    dict={dict}
                  />
                  <AccountFallbackSection
                    accounts={accounts}
                    bindings={form.draft.accounts}
                    profiles={form.draft.feeProfiles}
                    onUpdateAccountProfile={form.updateAccountProfile}
                    dict={dict}
                  />
                  <SecurityBindingsSection
                    accounts={accounts}
                    profiles={form.draft.feeProfiles}
                    bindings={form.draft.feeProfileBindings}
                    onAddBinding={form.addBinding}
                    onUpdateBinding={form.updateBinding}
                    onRemoveBinding={form.removeBinding}
                    dict={dict}
                  />
                </>
              )}
            </div>
          </div>

          <UnsavedChangesFooter
            isDirty={form.isDirty}
            showCloseWarning={form.showCloseWarning}
            validationError={form.validationError}
            errorMessage={errorMessage}
            discardNotice={form.discardNotice}
            isSaving={isSaving}
            onKeepEditing={() => form.setShowCloseWarning(false)}
            onCancel={() => form.handleOpenChange(false)}
            onCloseWithoutSaving={() => {
              form.setShowCloseWarning(false);
              onOpenChange(false);
            }}
            onDiscardChanges={form.resetToBaseline}
            dict={dict}
          />
        </form>
      )}
    </SettingsDrawerShell>
  );
}
