"use client";

import { useMemo } from "react";
import type {
  AccountDefaultCurrency,
  AccountDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  ProfileDto,
  UserSettings,
} from "@vakwen/shared-types";
import type { FormEvent } from "react";
import type { AppDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { GeneralSettingsSection } from "../../features/settings/components/GeneralSettingsSection";
import { AccountsListSection } from "../../features/settings/components/AccountsListSection";
import { AccountCreateForm } from "../../features/settings/components/AccountCreateForm";
import { createAccount } from "../../features/cash-ledger/services/cashLedgerService";
import { ProfileSection } from "../../features/settings/components/ProfileSection";
import { MonitoredTickersSection } from "../../features/settings/components/MonitoredTickersSection";
import { InstrumentCatalogSheet } from "../../features/settings/components/InstrumentCatalogSheet";
import { SettingsDrawerShell } from "../../features/settings/components/SettingsDrawerShell";
import { UnsavedChangesFooter } from "../../features/settings/components/UnsavedChangesFooter";
import { useSettingsForm } from "../../features/settings/hooks/useSettingsForm";
import { useMonitoredTickers } from "../../features/settings/hooks/useMonitoredTickers";
import type {
  SettingsFormModel,
  SettingsTab,
} from "../../features/settings/types/settingsUi";
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
  // KZO-180 — onReportingCurrencySaved added for the new reporting-currency
  // selector in the Display tab.
  onTimeframesSaved?: () => void;
  onLayoutReset?: () => void;
  onPageLayoutReset?: (page: ReorderablePage) => void;
  onReportingCurrencySaved?: () => void;
  // KZO-169 (NC4): deep-link support for the create-account flow. AppShell
  // reads `?settingsTab=accounts&accountsPrefillCurrency=USD` from the URL
  // and passes them in. AccountCreateForm uses `accountsPrefillCurrency` as
  // its initial defaultCurrency selection.
  initialTab?: SettingsTab;
  accountsPrefillCurrency?: AccountDefaultCurrency;
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
  onReportingCurrencySaved,
  initialTab,
  accountsPrefillCurrency,
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
    initialTab,
  });

  const tickers = useMonitoredTickers(open && form.tab === "tickers");

  const positionTickers = useMemo(
    () => new Set(tickers.monitoredTickers.filter((s) => s.source === "position").map((s) => `${s.ticker}|${s.marketCode}`)),
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
          {/* KZO-183: tab strip drops to 5 (Profile / General / Accounts /
              Tickers / Display) — Fees tab removed; per-account fee-profile
              UX moved into the Accounts tab. `flex-wrap` retained from the
              KZO-179 iter-2 LOW fix so the strip wraps gracefully on narrow
              viewports. */}
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
                  onReportingCurrencySaved={onReportingCurrencySaved ?? (() => undefined)}
                />
              </div>
            </div>
          )}

          {/* KZO-179 / KZO-183 — Accounts tab. AccountCreateForm has its own
              internal <form> for Enter-key submit UX, so this section MUST NOT
              wrap its content in a <form>. The UnsavedChangesFooter is rendered
              here so users can save profile/binding edits from the Accounts tab
              without navigating to General; the save button uses a click
              handler (no submit) to avoid HTML nested-form issues. */}
          {form.tab === "accounts" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
                  <AccountCreateForm
                    onCreate={createAccount}
                    onAccountsRefresh={onAccountsRefresh}
                    dict={dict}
                    prefillCurrency={accountsPrefillCurrency}
                  />
                  <AccountsListSection
                    accounts={accounts}
                    accountDrafts={form.draft.accounts}
                    profiles={form.draft.feeProfiles}
                    feeProfileBindings={form.draft.feeProfileBindings}
                    activeLocale={settings?.locale ?? "en"}
                    onUpdateAccountProfile={form.updateAccountProfile}
                    onRenameAccount={onRenameAccount}
                    onAddProfileForAccount={form.addProfileForAccount}
                    onUpdateProfileField={form.updateProfileField}
                    onRemoveProfileFromAccount={form.removeProfileFromAccount}
                    onDuplicateProfilesFromAccount={form.duplicateProfilesFromAccount}
                    onAddBinding={form.addBinding}
                    onUpdateBinding={form.updateBinding}
                    onRemoveBinding={form.removeBinding}
                    onAccountsChanged={onAccountsRefresh}
                    effectiveAccountHardPurgeDays={settings?.effectiveAccountHardPurgeDays}
                    dict={dict}
                  />
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
                onSaveClick={() => void form.handleSubmit()}
                dict={dict}
              />
            </div>
          )}

          {form.tab === "general" && (
            // KZO-183: noValidate so the JS validator (validateSettingsForm) is
            // the sole source of truth — HTML5 constraint validation on the
            // number input (min={1}) would otherwise block submission and
            // hide the localized validation message.
            <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={handleSubmit}>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 space-y-4 overflow-y-auto pr-1 md:space-y-5" data-testid="settings-content-scroll">
                  <GeneralSettingsSection
                    locale={form.draft.locale}
                    costBasisMethod={form.draft.costBasisMethod}
                    quotePollInterval={form.quotePollInterval}
                    onLocaleChange={(locale) => form.updateField("locale", locale)}
                    onCostBasisChange={(costBasisMethod) => form.updateField("costBasisMethod", costBasisMethod)}
                    onQuotePollIntervalChange={form.setQuotePollInterval}
                    dict={dict}
                  />
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
