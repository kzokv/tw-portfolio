"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type {
  AccountDefaultCurrency,
  AccountDto,
  LocaleCode,
} from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { getCurrencyOptions } from "../../../lib/currencies";
import { fromZhFoldValue, toZhFoldValue } from "../services/commissionDiscount";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../types/settingsUi";

/**
 * KZO-183: per-account expandable cards. Each card replaces the
 * legacy `FeeProfilesSection` + `SecurityBindingsSection` for a single
 * account — fee profiles, default-profile selector, "Duplicate from
 * another account" CTA, and per-symbol overrides all live inline.
 *
 * Search input above the cards filters by profile-name substring; cards
 * with hits stay expanded, misses collapse. Empty input → all cards
 * default to collapsed.
 */
interface AccountsListSectionProps {
  accounts: AccountDto[];
  /**
   * KZO-183: per-account draft entries from the settings form (one per account,
   * carrying the editable `feeProfileId` for the default-profile selector).
   * Renamed from `bindings` (SettingsAccountBindingModel naming was misleading
   * — these are account drafts, not fee-profile-bindings).
   */
  accountDrafts: SettingsAccountBindingModel[];
  profiles: SettingsProfileModel[];
  feeProfileBindings: SettingsSecurityBindingModel[];
  activeLocale: LocaleCode;
  onUpdateAccountProfile: (accountId: string, feeProfileId: string) => void;
  onRenameAccount: (accountId: string, name: string) => Promise<void>;
  onAddProfileForAccount: (accountId: string) => void;
  onUpdateProfileField: (
    profileId: string,
    key: keyof SettingsProfileModel,
    value: string | number,
  ) => void;
  onRemoveProfileFromAccount: (accountId: string, profileId: string) => void;
  onDuplicateProfilesFromAccount: (
    sourceAccountId: string,
    targetAccountId: string,
    profileIds: string[],
    sourceAccountName?: string,
  ) => void;
  onAddBinding: (accountId: string) => void;
  onUpdateBinding: (
    index: number,
    patch: Partial<SettingsSecurityBindingModel>,
  ) => void;
  onRemoveBinding: (index: number) => void;
  dict: AppDictionary;
}

const PROFILE_FIELDS: ReadonlyArray<{
  key: keyof SettingsProfileModel;
  label: keyof AppDictionary["settings"];
  min?: number;
  step?: number;
}> = [
  { key: "boardCommissionRate", label: "profileCommissionLabel", min: 0, step: 0.001 },
  { key: "minimumCommissionAmount", label: "profileMinimumCommissionLabel", min: 0 },
  { key: "stockSellTaxRateBps", label: "profileStockTaxLabel", min: 0 },
  { key: "stockDayTradeTaxRateBps", label: "profileDayTradeTaxLabel", min: 0 },
  { key: "etfSellTaxRateBps", label: "profileEtfTaxLabel", min: 0 },
  { key: "bondEtfSellTaxRateBps", label: "profileBondEtfTaxLabel", min: 0 },
];

/**
 * KZO-183: derive the market badge label from the account's default
 * currency. Mirrors the planned `marketCodeFor` helper landing in
 * shared-types via backend B1.
 */
function marketBadgeLabel(
  currency: AccountDefaultCurrency,
  dict: AppDictionary,
): string {
  switch (currency) {
    case "TWD": return dict.settings.accountsListMarketBadgeTW;
    case "USD": return dict.settings.accountsListMarketBadgeUS;
    case "AUD": return dict.settings.accountsListMarketBadgeAU;
  }
}

function marketBadgeColorClass(currency: AccountDefaultCurrency): string {
  switch (currency) {
    case "TWD": return "bg-emerald-50 text-emerald-700";
    case "USD": return "bg-indigo-50 text-indigo-700";
    case "AUD": return "bg-rose-50 text-rose-700";
  }
}

function accountTypeLabel(account: AccountDto, dict: AppDictionary): string {
  switch (account.accountType) {
    case "broker": return dict.settings.accountsListAccountTypeBroker;
    case "bank": return dict.settings.accountsListAccountTypeBank;
    case "wallet": return dict.settings.accountsListAccountTypeWallet;
  }
}

function formatAccountSummary(
  account: AccountDto,
  profileCount: number,
  dict: AppDictionary,
): string {
  return dict.settings.accountsListAccountSummary
    .replace("{type}", accountTypeLabel(account, dict))
    .replace("{currency}", account.defaultCurrency)
    .replace("{profileCount}", String(profileCount));
}

export function AccountsListSection({
  accounts,
  accountDrafts,
  profiles,
  feeProfileBindings,
  activeLocale,
  onUpdateAccountProfile,
  onRenameAccount,
  onAddProfileForAccount,
  onUpdateProfileField,
  onRemoveProfileFromAccount,
  onDuplicateProfilesFromAccount,
  onAddBinding,
  onUpdateBinding,
  onRemoveBinding,
  dict,
}: AccountsListSectionProps) {
  // Rename UI state.
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renameOverrides, setRenameOverrides] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");

  // Expand state — keys are accountIds. Search overrides the user-driven
  // expand state (cards with hits force-expand; misses force-collapse).
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});

  // Profile editor state — only one profile per account is open at a time.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  // Search input.
  const [searchInput, setSearchInput] = useState("");
  const search = searchInput.trim().toLowerCase();

  // Duplicate-picker state.
  const [duplicateTargetAccountId, setDuplicateTargetAccountId] = useState<string | null>(null);
  const [duplicateSourceAccountId, setDuplicateSourceAccountId] = useState<string>("");
  const [duplicateSelected, setDuplicateSelected] = useState<Set<string>>(new Set());

  const accountNames = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          renameOverrides[account.id] ?? account.name,
        ]),
      ),
    [accounts, renameOverrides],
  );

  const profilesByAccount = useMemo(() => {
    const result = new Map<string, SettingsProfileModel[]>();
    for (const account of accounts) {
      result.set(account.id, []);
    }
    for (const profile of profiles) {
      const list = result.get(profile.accountId);
      if (list) list.push(profile);
    }
    return result;
  }, [accounts, profiles]);

  const matchedAccountIds = useMemo(() => {
    if (search.length === 0) return new Set<string>();
    const matched = new Set<string>();
    for (const profile of profiles) {
      if (profile.name.toLowerCase().includes(search)) {
        matched.add(profile.accountId);
      }
    }
    return matched;
  }, [profiles, search]);

  // KZO-183 scope decision 27 + design E5: search filters EXPANSION state, not
  // visibility. All cards remain visible; matches expand, misses collapse.

  function expandedFor(accountId: string): boolean {
    if (search.length > 0) return matchedAccountIds.has(accountId);
    return manualExpanded[accountId] ?? false;
  }

  function toggleExpand(accountId: string) {
    if (search.length > 0) return; // search drives expand state
    setManualExpanded((current) => ({
      ...current,
      [accountId]: !(current[accountId] ?? false),
    }));
  }

  function startRename(account: AccountDto) {
    setRenameError("");
    setEditingAccountId(account.id);
    setDraftName(accountNames.get(account.id) ?? account.name);
  }

  function cancelRename(accountId: string) {
    setRenameError("");
    setEditingAccountId((current) => (current === accountId ? null : current));
    setDraftName("");
  }

  async function saveRename(accountId: string) {
    const trimmedName = draftName.trim();
    if (!trimmedName) return;

    setSavingAccountId(accountId);
    setRenameError("");
    try {
      await onRenameAccount(accountId, trimmedName);
      setRenameOverrides((current) => ({ ...current, [accountId]: trimmedName }));
      setEditingAccountId(null);
      setDraftName("");
    } catch {
      setRenameError(dict.settings.accountRenameError);
    } finally {
      setSavingAccountId(null);
    }
  }

  function openDuplicatePicker(targetAccountId: string) {
    const fallbackSource = accounts.find((account) => account.id !== targetAccountId)?.id ?? "";
    setDuplicateTargetAccountId(targetAccountId);
    setDuplicateSourceAccountId(fallbackSource);
    setDuplicateSelected(new Set());
  }

  function closeDuplicatePicker() {
    setDuplicateTargetAccountId(null);
    setDuplicateSourceAccountId("");
    setDuplicateSelected(new Set());
  }

  function toggleDuplicateSelection(profileId: string) {
    setDuplicateSelected((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function confirmDuplicate() {
    if (
      duplicateTargetAccountId === null
      || duplicateSourceAccountId === ""
      || duplicateSelected.size === 0
    ) {
      return;
    }
    const sourceAccount = accounts.find((account) => account.id === duplicateSourceAccountId);
    onDuplicateProfilesFromAccount(
      duplicateSourceAccountId,
      duplicateTargetAccountId,
      Array.from(duplicateSelected),
      sourceAccount ? (renameOverrides[sourceAccount.id] ?? sourceAccount.name) : undefined,
    );
    closeDuplicatePicker();
  }

  // KZO-183: when the duplicate picker is open and the user changes the
  // source account, drop any selected profile ids that are no longer owned
  // by the new source so the list view stays consistent.
  useEffect(() => {
    if (duplicateTargetAccountId === null) return;
    const validIds = new Set(
      profiles
        .filter((profile) => profile.accountId === duplicateSourceAccountId)
        .map((profile) => profile.id),
    );
    setDuplicateSelected((current) => {
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [duplicateSourceAccountId, duplicateTargetAccountId, profiles]);

  const isTraditionalChinese = activeLocale === "zh-TW";

  return (
    <section className="glass-inset space-y-3 rounded-[24px] p-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-ink">{dict.settings.accountsListSectionTitle}</h3>
        <p className="text-xs text-slate-400">{dict.settings.accountsListSectionDescription}</p>
      </div>

      {/* KZO-183 E5 — top-of-tab search input. */}
      <div className="space-y-1">
        <label
          htmlFor="accounts-tab-search"
          className="block text-xs font-medium text-slate-500"
        >
          {dict.settings.accountsTabSearchLabel}
        </label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="accounts-tab-search"
            type="text"
            value={searchInput}
            onChange={(event) => {
              const next = event.target.value;
              // KZO-183 scope item 27: clearing the search returns all cards to
              // their default collapsed state (don't carry pre-search manual
              // expansions back into the post-clear view).
              if (next.trim().length === 0) {
                setManualExpanded({});
              }
              setSearchInput(next);
            }}
            placeholder={dict.settings.accountsTabSearchPlaceholder}
            className={`${fieldClassName} pl-9`}
            data-testid="accounts-tab-search"
          />
        </div>
      </div>

      {renameError ? <p className="text-xs text-rose-500">{renameError}</p> : null}

      <div className="space-y-3">
        {accounts.map((account) => {
          const draftAccount = accountDrafts.find((item) => item.id === account.id);
          const ownedProfiles = profilesByAccount.get(account.id) ?? [];
          const ownedProfileIds = new Set(ownedProfiles.map((profile) => profile.id));
          const expanded = expandedFor(account.id);
          const displayName = accountNames.get(account.id) ?? account.name;
          const isEditing = editingAccountId === account.id;
          const isSaving = savingAccountId === account.id;
          const disableRenameSave = draftName.trim().length === 0 || isSaving;

          // Per-account overrides — `feeProfileBindings` carries flat (idx, accountId,
          // ticker, feeProfileId). We render only those that belong to this account
          // and pass the index into the legacy `onUpdateBinding`/`onRemoveBinding`
          // surface (which operates on the flat array).
          const accountOverrides = feeProfileBindings
            .map((binding, index) => ({ binding, index }))
            .filter((entry) => entry.binding.accountId === account.id);

          return (
            <article
              key={account.id}
              className="rounded-[18px] border border-white/10 bg-slate-950/35"
              data-testid={`accounts-card-${account.id}`}
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(account.id)}
                  className="text-slate-300 transition hover:text-white"
                  aria-label={
                    expanded
                      ? dict.settings.accountsListCollapseLabel
                      : dict.settings.accountsListExpandLabel
                  }
                  aria-expanded={expanded}
                  data-testid={`accounts-card-${account.id}-toggle`}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className={fieldClassName}
                        placeholder={dict.settings.accountRenamePlaceholder}
                        data-testid="account-name-input"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveRename(account.id)}
                          disabled={disableRenameSave}
                          data-testid="account-rename-save"
                        >
                          {dict.settings.accountRenameSave}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => cancelRename(account.id)}
                          data-testid="account-rename-cancel"
                        >
                          {dict.actions.cancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-medium text-ink"
                          data-testid="account-name-label"
                        >
                          {displayName}
                        </span>
                        <span className="rounded-full border border-white/10 bg-slate-900/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-300">
                          {accountTypeLabel(account, dict)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${marketBadgeColorClass(account.defaultCurrency)}`}
                          data-testid={`accounts-card-${account.id}-market-badge`}
                        >
                          {marketBadgeLabel(account.defaultCurrency, dict)}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {formatAccountSummary(account, ownedProfiles.length, dict)}
                      </p>
                    </div>
                  )}
                </div>

                {!isEditing ? (
                  <button
                    type="button"
                    onClick={() => startRename(account)}
                    className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:border-white/20 hover:text-white"
                    data-testid="account-rename-icon"
                    aria-label={dict.settings.accountRenameIconLabel}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {expanded ? (
                <div className="space-y-4 px-4 py-4">
                  {/* Default fee profile selector (scoped to this account's profiles). */}
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-400">
                      {dict.settings.accountsListDefaultProfileLabel}
                    </label>
                    <select
                      value={
                        draftAccount && ownedProfileIds.has(draftAccount.feeProfileId)
                          ? draftAccount.feeProfileId
                          : ""
                      }
                      onChange={(event) => onUpdateAccountProfile(account.id, event.target.value)}
                      className={fieldClassName}
                      data-testid={`settings-account-profile-${account.id}`}
                    >
                      {ownedProfiles.length === 0 ? (
                        <option value="">{dict.settings.accountsListNoProfilesYet}</option>
                      ) : null}
                      {ownedProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500">
                      {dict.settings.accountsListDefaultProfileHint}
                    </p>
                  </div>

                  {/* Inline fee profiles list. */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        {dict.settings.accountsListProfilesSectionLabel}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => onAddProfileForAccount(account.id)}
                          data-testid={`accounts-card-${account.id}-add-profile`}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {dict.settings.accountsListAddProfile}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => openDuplicatePicker(account.id)}
                          data-testid={`accounts-card-${account.id}-duplicate-cta`}
                          disabled={accounts.length < 2}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          {dict.settings.accountsListDuplicateFromAnotherCta}
                        </Button>
                      </div>
                    </div>

                    {ownedProfiles.length === 0 ? (
                      <p className="rounded-[14px] border border-dashed border-white/15 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
                        {dict.settings.accountsListNoProfilesYet}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ownedProfiles.map((profile) => {
                          const isProfileEditing = editingProfileId === profile.id;
                          return (
                            <div
                              key={profile.id}
                              className="rounded-[14px] border border-white/10 bg-slate-950/40 px-3 py-2"
                              data-testid={`accounts-card-${account.id}-profile-${profile.id}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p
                                    className="text-sm font-medium text-ink truncate"
                                    data-testid={`accounts-profile-name-${profile.id}`}
                                  >
                                    {profile.name || dict.settings.accountsListProfileSummaryFallback}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {`${profile.boardCommissionRate}‰ commission · ${profile.commissionCurrency}`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingProfileId(isProfileEditing ? null : profile.id)
                                    }
                                    aria-label={dict.settings.accountsListEditProfileLabel}
                                    className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                                    data-testid={`accounts-profile-edit-${profile.id}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRemoveProfileFromAccount(account.id, profile.id)}
                                    aria-label={dict.settings.accountsListDeleteProfileLabel}
                                    className="rounded p-1 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400"
                                    data-testid={`accounts-profile-remove-${profile.id}`}
                                    disabled={ownedProfiles.length <= 1}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              {isProfileEditing ? (
                                <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                                  <label className="space-y-2 text-xs text-slate-400">
                                    {dict.settings.profileNameLabel}
                                    <input
                                      value={profile.name}
                                      onChange={(event) =>
                                        onUpdateProfileField(profile.id, "name", event.target.value)
                                      }
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-name-input-${profile.id}`}
                                    />
                                  </label>

                                  <label className="space-y-2 text-xs text-slate-400">
                                    <span>{dict.settings.profileDiscountLabel}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={isTraditionalChinese ? 10 : 100}
                                      step={0.01}
                                      value={
                                        isTraditionalChinese
                                          ? toZhFoldValue(profile.commissionDiscountPercent)
                                          : profile.commissionDiscountPercent
                                      }
                                      onChange={(event) => {
                                        const nextValue = Number(event.target.value) || 0;
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionDiscountPercent",
                                          isTraditionalChinese ? fromZhFoldValue(nextValue) : nextValue,
                                        );
                                      }}
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-discount-${profile.id}`}
                                    />
                                    <p className="text-[11px] text-slate-500">
                                      {dict.settings.profileDiscountHint}
                                    </p>
                                  </label>

                                  {PROFILE_FIELDS.map((field) => (
                                    <label
                                      key={field.key}
                                      className="space-y-2 text-xs text-slate-400"
                                    >
                                      {dict.settings[field.label]}
                                      <input
                                        type="number"
                                        min={field.min}
                                        step={field.step}
                                        value={profile[field.key] as number}
                                        onChange={(event) =>
                                          onUpdateProfileField(
                                            profile.id,
                                            field.key,
                                            Number(event.target.value) || 0,
                                          )
                                        }
                                        className={fieldClassName}
                                      />
                                    </label>
                                  ))}

                                  <label className="space-y-2 text-xs text-slate-400">
                                    {dict.settings.profileCommissionCurrencyLabel}
                                    <select
                                      value={profile.commissionCurrency}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionCurrency",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                    >
                                      {getCurrencyOptions([profile.commissionCurrency]).map(
                                        (currency) => (
                                          <option key={currency} value={currency}>
                                            {currency}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </label>

                                  <label className="space-y-2 text-xs text-slate-400">
                                    {dict.settings.profileCommissionRoundLabel}
                                    <select
                                      value={profile.commissionRoundingMode}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionRoundingMode",
                                          event.target.value,
                                        )
                                      }
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
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "taxRoundingMode",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                    >
                                      <option value="FLOOR">FLOOR</option>
                                      <option value="ROUND">ROUND</option>
                                      <option value="CEIL">CEIL</option>
                                    </select>
                                  </label>

                                  <label className="space-y-2 text-xs text-slate-400">
                                    {dict.settings.profileChargeModeLabel}
                                    <select
                                      value={profile.commissionChargeMode}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionChargeMode",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-charge-mode-${profile.id}`}
                                    >
                                      <option value="CHARGED_UPFRONT">CHARGED_UPFRONT</option>
                                      <option value="CHARGED_UPFRONT_REBATED_LATER">
                                        CHARGED_UPFRONT_REBATED_LATER
                                      </option>
                                    </select>
                                  </label>
                                </div>
                              ) : null}

                              {isProfileEditing ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => setEditingProfileId(null)}
                                    data-testid={`accounts-profile-edit-done-${profile.id}`}
                                  >
                                    {dict.settings.accountsListSaveProfileEdit}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Per-symbol overrides. */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        {dict.settings.accountsListOverridesSectionLabel}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onAddBinding(account.id)}
                        data-testid={`accounts-card-${account.id}-add-override`}
                        disabled={ownedProfiles.length === 0}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {dict.settings.accountsListAddOverride}
                      </Button>
                    </div>

                    {accountOverrides.length === 0 ? (
                      <p className="rounded-[14px] border border-dashed border-white/15 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
                        {dict.settings.accountsListOverridesEmptyState}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {accountOverrides.map(({ binding, index }) => (
                          <div
                            key={`${binding.accountId}-${binding.ticker}-${index}`}
                            className="grid items-center gap-2 rounded-[14px] border border-white/10 bg-slate-950/40 px-3 py-2 lg:grid-cols-[140px_1fr_auto]"
                            data-testid={`accounts-override-row-${index}`}
                          >
                            <input
                              value={binding.ticker}
                              onChange={(event) =>
                                onUpdateBinding(index, {
                                  ticker: event.target.value.toUpperCase(),
                                })
                              }
                              className={fieldClassName}
                              maxLength={16}
                              placeholder={dict.settings.accountsListOverrideTickerPlaceholder}
                              data-testid={`accounts-override-ticker-${index}`}
                            />
                            <select
                              value={
                                ownedProfileIds.has(binding.feeProfileId)
                                  ? binding.feeProfileId
                                  : ""
                              }
                              onChange={(event) =>
                                onUpdateBinding(index, { feeProfileId: event.target.value })
                              }
                              className={fieldClassName}
                              data-testid={`accounts-override-profile-${index}`}
                            >
                              {ownedProfiles.length === 0 ? (
                                <option value="">{dict.settings.accountsListNoProfilesYet}</option>
                              ) : null}
                              {ownedProfiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => onRemoveBinding(index)}
                              aria-label={dict.settings.accountsListOverrideRemoveLabel}
                              className="rounded p-1 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400"
                              data-testid={`accounts-override-remove-${index}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {/* KZO-183: duplicate-from-another-account picker. Inline panel keeps the
          UX self-contained without a portal/dialog dependency; the picker is
          per-target-account. */}
      {duplicateTargetAccountId !== null ? (
        <div
          className="space-y-3 rounded-[18px] border border-indigo-300/60 bg-indigo-500/10 p-4 text-sm"
          data-testid="accounts-duplicate-picker"
        >
          <div>
            <p className="text-sm font-semibold text-indigo-100">
              {dict.settings.accountsListDuplicatePickerTitle}
            </p>
            <p className="mt-0.5 text-xs text-indigo-200/80">
              {dict.settings.accountsListDuplicatePickerDescription}
            </p>
          </div>

          <label className="block space-y-1 text-xs text-indigo-100">
            {dict.settings.accountsListDuplicatePickerSourceLabel}
            <select
              value={duplicateSourceAccountId}
              onChange={(event) => setDuplicateSourceAccountId(event.target.value)}
              className={fieldClassName}
              data-testid="accounts-duplicate-source-select"
            >
              {accounts
                .filter((account) => account.id !== duplicateTargetAccountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountNames.get(account.id) ?? account.name}
                  </option>
                ))}
            </select>
          </label>

          {(() => {
            const sourceProfiles = profiles.filter(
              (profile) => profile.accountId === duplicateSourceAccountId,
            );
            if (sourceProfiles.length === 0) {
              return (
                <p className="text-xs text-indigo-100">
                  {dict.settings.accountsListDuplicatePickerEmpty}
                </p>
              );
            }
            return (
              <ul className="space-y-1" data-testid="accounts-duplicate-source-profiles">
                {sourceProfiles.map((profile) => {
                  const checked = duplicateSelected.has(profile.id);
                  return (
                    <li key={profile.id}>
                      <label className="flex items-center gap-2 text-xs text-indigo-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDuplicateSelection(profile.id)}
                          data-testid={`accounts-duplicate-checkbox-${profile.id}`}
                        />
                        <span>{profile.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            );
          })()}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={confirmDuplicate}
              disabled={duplicateSelected.size === 0}
              data-testid="accounts-duplicate-confirm"
            >
              {dict.settings.accountsListDuplicateConfirm}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={closeDuplicatePicker}
              data-testid="accounts-duplicate-cancel"
            >
              {dict.settings.accountsListDuplicateCancel}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
