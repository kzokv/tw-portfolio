"use client";

import { useMemo } from "react";
import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, ProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import type { FormEvent } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { GeneralSettingsSection } from "../../features/settings/components/GeneralSettingsSection";
import { FeeProfilesSection } from "../../features/settings/components/FeeProfilesSection";
import { AccountsListSection } from "../../features/settings/components/AccountsListSection";
import { AccountCreateForm } from "../../features/settings/components/AccountCreateForm";
import { createAccount } from "../../features/cash-ledger/services/cashLedgerService";
import { SecurityBindingsSection } from "../../features/settings/components/SecurityBindingsSection";
import { ProfileSection } from "../../features/settings/components/ProfileSection";
import { MonitoredTickersSection } from "../../features/settings/components/MonitoredTickersSection";
import { InstrumentCatalogSheet } from "../../features/settings/components/InstrumentCatalogSheet";
import { SettingsDrawerShell } from "../../features/settings/components/SettingsDrawerShell";
import { UnsavedChangesFooter } from "../../features/settings/components/UnsavedChangesFooter";
import { useSettingsForm } from "../../features/settings/hooks/useSettingsForm";
import { useMonitoredTickers } from "../../features/settings/hooks/useMonitoredTickers";
import type { SettingsFormModel } from "../../features/settings/types/settingsUi";
import { DisplayTabSection, type ReorderablePage } from "./DisplayTabSection";

export type SettingsDraft = SettingsFormModel;

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UserSettings | null;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  profile: ProfileDto | null;
  onProfileUpdate: () => void;
  // KZO-179 — re-fetch dashboard.accounts after a successful POST /accounts
  // from the new Accounts tab. Mirrors the onProfileUpdate prop shape.
  onAccountsRefresh: () => void;
  isSaving: boolean;
  errorMessage: string;
  onSave: (draft: SettingsDraft) => Promise<void>;
  onRenameAccount: (accountId: string, name: string) => Promise<void>;
  dict: AppDictionary;
  // KZO-161 (158C) — Display tab callbacks. Default no-ops keep existing
  // call sites working until they wire the new behavior.
  // KZO-162 — onPageLayoutReset added for the per-page Reset buttons.
  onTimeframesSaved?: () => void;
  onLayoutReset?: () => void;
  onPageLayoutReset?: (page: ReorderablePage) => void;
}

export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  accounts,
  feeProfiles,
  feeProfileBindings,
  profile,
  onProfileUpdate,
  onAccountsRefresh,
  isSaving,
  errorMessage,
  onSave,
  onRenameAccount,
  dict,
  onTimeframesSaved,
  onLayoutReset,
  onPageLayoutReset,
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

  const tickers = useMonitoredTickers(open && form.tab === "tickers");

  const positionTickers = useMemo(
    () => new Set(tickers.monitoredTickers.filter((s) => s.source === "position").map((s) => s.ticker)),
    [tickers.monitoredTickers],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.handleSubmit();
  }

  return (
    <SettingsDrawerShell open={open} onOpenChange={form.handleOpenChange} expanded={form.tab === "tickers" && tickers.showCatalog} dict={dict}>
      {!form.draft ? (
        <p className="text-sm text-slate-300">{dict.feedback.loadingSettings}</p>
      ) : (
        <>
          {/* KZO-179 iter-2 LOW fix — `flex-wrap` so the 6-tab strip wraps to
              two rows at narrow viewports (e.g. iPhone 14 Pro / 390px) instead
              of overflowing off-screen. The pre-existing 5-tab strip happened
              to fit common widths without wrap; the 6th tab dropped the
              overflow threshold below 390px. Desktop (≥md) still renders
              single-row. `rounded-full` retained — verified acceptable when
              the wrapped row pill stacks tightly under the first row. */}
          <div className="mb-3 inline-flex w-fit flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50/90 p-1 md:mb-4">
            <Button
              type="button"
              variant={form.tab === "profile" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "profile" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("profile")}
              data-testid="settings-tab-profile"
            >
              {dict.settings.tabProfile}
            </Button>
            <Button
              type="button"
              variant={form.tab === "general" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "general" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("general")}
              data-testid="settings-tab-general"
            >
              {dict.settings.tabGeneral}
            </Button>
            <Button
              type="button"
              variant={form.tab === "fees" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "fees" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("fees")}
              data-testid="settings-tab-fees"
            >
              {dict.settings.tabFeeProfiles}
            </Button>
            <Button
              type="button"
              variant={form.tab === "accounts" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "accounts" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("accounts")}
              data-testid="settings-tab-accounts"
            >
              {dict.settings.tabAccounts}
            </Button>
            <Button
              type="button"
              variant={form.tab === "tickers" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "tickers" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("tickers")}
              data-testid="settings-tab-tickers"
            >
              {dict.settings.tabTickers}
            </Button>
            <Button
              type="button"
              variant={form.tab === "display" ? "default" : "secondary"}
              size="sm"
              className={form.tab !== "display" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
              onClick={() => form.setTab("display")}
              data-testid="settings-tab-display"
            >
              {dict.settings.tabDisplay}
            </Button>
          </div>

          {form.tab === "profile" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
                <ProfileSection profile={profile} onProfileUpdate={onProfileUpdate} dict={dict} />
              </div>
            </div>
          )}

          {form.tab === "tickers" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pr-1" data-testid="settings-content-scroll">
                {tickers.showCatalog ? (
                  <InstrumentCatalogSheet
                    instruments={tickers.instruments}
                    selectedTickers={tickers.selectedTickers}
                    positionTickers={positionTickers}
                    onToggleTicker={tickers.toggleTicker}
                    onBack={() => tickers.setShowCatalog(false)}
                    dict={dict}
                  />
                ) : (
                  <MonitoredTickersSection
                    monitoredTickers={tickers.monitoredTickers}
                    instruments={tickers.instruments}
                    selectedTickers={tickers.selectedTickers}
                    onToggleTicker={tickers.toggleTicker}
                    onBrowseCatalog={() => tickers.setShowCatalog(true)}
                    onRetryBackfill={tickers.retryTicker}
                    isDirty={tickers.isDirty}
                    isSaving={tickers.isSaving}
                    saveError={tickers.saveError}
                    saveSuccess={tickers.saveSuccess}
                    onSave={tickers.save}
                    isLoading={tickers.isLoading}
                    repairMode={tickers.repairMode}
                    onRepairModeChange={tickers.setRepairMode}
                    repairSelection={tickers.repairSelection}
                    onToggleRepairSelection={tickers.toggleRepairSelection}
                    onClearRepairSelection={tickers.clearRepairSelection}
                    onSubmitRepairRequests={tickers.submitRepairRequests}
                    isRepairSubmitting={tickers.isRepairSubmitting}
                    repairMessage={tickers.repairMessage}
                    repairError={tickers.repairError}
                    dict={dict}
                  />
                )}
              </div>
            </div>
          )}

          {form.tab === "display" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
                <DisplayTabSection
                  dict={dict}
                  onTimeframesSaved={onTimeframesSaved ?? (() => undefined)}
                  onLayoutReset={onLayoutReset ?? (() => undefined)}
                  onPageLayoutReset={onPageLayoutReset ?? (() => undefined)}
                />
              </div>
            </div>
          )}

          {/* KZO-179 H1 fix — Accounts tab is a sibling render block (mirrors
              profile / tickers / display container shape). It is NOT inside
              the outer settings-save <form>, so:
                - Enter inside `account-create-name-input` does NOT trigger
                  the settings save.
                - UnsavedChangesFooter (settings-save context) does not render.
              AccountCreateForm has its own internal <form> for Enter-key
              submit UX. AccountsListSection's binding-profile <select> still
              mutates form.draft via form.updateAccountProfile — those edits
              surface in the UnsavedChangesFooter when the user navigates
              back to General / Fees. Rename is immediate (its own API). */}
          {form.tab === "accounts" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
                <AccountCreateForm
                  feeProfiles={feeProfiles}
                  onCreate={createAccount}
                  onAccountsRefresh={onAccountsRefresh}
                  dict={dict}
                />
                <AccountsListSection
                  accounts={accounts}
                  bindings={form.draft.accounts}
                  profiles={form.draft.feeProfiles}
                  onUpdateAccountProfile={form.updateAccountProfile}
                  onRenameAccount={onRenameAccount}
                  dict={dict}
                />
              </div>
            </div>
          )}

          {(form.tab === "general" || form.tab === "fees") && (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
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
                        activeLocale={settings?.locale ?? "en"}
                        onAddProfile={form.addProfile}
                        onRemoveProfile={form.removeProfile}
                        onUpdateProfileField={form.updateProfileField}
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
        </>
      )}
    </SettingsDrawerShell>
  );
}
