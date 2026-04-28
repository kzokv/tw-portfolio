"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { toSettingsFormModel } from "../mappers/settingsMappers";
import {
  cloneSettingsForm,
  createDraftProfile,
  normalizeSettingsForm,
  removeProfileFromSettingsForm,
  serializeSettingsForm,
} from "../services/settingsDraft";
import type { SettingsFormModel, SettingsProfileModel, SettingsTab } from "../types/settingsUi";
import { validateSettingsForm } from "../validators/settingsValidation";

/**
 * KZO-183: deterministic-ish unique id for client-side draft profiles.
 * `crypto.randomUUID()` when available; falls back to a timestamp+counter
 * concatenation for older runtimes (older Node test workers, jsdom variants).
 */
let __draftProfileSeqCounter = 0;
function newDraftProfileId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `tmp-${cryptoApi.randomUUID()}`;
  }
  __draftProfileSeqCounter += 1;
  return `tmp-${Date.now()}-${__draftProfileSeqCounter}`;
}

function isAutoSeedProfileStub(profile: SettingsProfileModel, account: AccountDto): boolean {
  return profile.id === account.feeProfileId
    && profile.accountId === account.id
    && profile.name === "Default Broker"
    && profile.boardCommissionRate === 1.425
    && profile.minimumCommissionAmount === 20
    && profile.commissionCurrency === account.defaultCurrency
    && profile.commissionRoundingMode === "FLOOR"
    && profile.taxRoundingMode === "FLOOR"
    && profile.commissionChargeMode === "CHARGED_UPFRONT";
}

interface UseSettingsFormOptions {
  open: boolean;
  settings: UserSettings | null;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  dict: AppDictionary;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: SettingsFormModel) => Promise<void>;
}

export function useSettingsForm({
  open,
  settings,
  accounts,
  feeProfiles,
  feeProfileBindings,
  dict,
  onOpenChange,
  onSave,
}: UseSettingsFormOptions) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [draft, setDraft] = useState<SettingsFormModel | null>(null);
  const [baseline, setBaseline] = useState<SettingsFormModel | null>(null);
  const [quotePollInterval, setQuotePollInterval] = useState("10");
  const [validationError, setValidationError] = useState("");
  const [discardNotice, setDiscardNotice] = useState("");
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open || !settings) {
      if (!open) {
        wasOpenRef.current = false;
      }
      return;
    }

    // Only seed the draft on the closed→open transition. While the drawer is
    // open, external snapshot updates (e.g. dashboard.refresh after an inline
    // account rename) must not clobber in-progress user edits to fee profiles
    // or bindings.
    if (wasOpenRef.current) {
      return;
    }

    const initial = toSettingsFormModel(settings, accounts, feeProfiles, feeProfileBindings);
    setDraft(cloneSettingsForm(initial));
    setBaseline(cloneSettingsForm(initial));
    setQuotePollInterval(String(initial.quotePollIntervalSeconds));
    setValidationError("");
    setDiscardNotice("");
    setShowCloseWarning(false);
    setTab("general");
    wasOpenRef.current = true;
  }, [accounts, feeProfileBindings, feeProfiles, open, settings]);

  // KZO-182 + KZO-183: While the drawer is open, additively merge newly-
  // arrived accounts (e.g. created via AccountCreateForm → dashboard.refresh)
  // into both draft and baseline. The closed→open seed guard above protects
  // in-progress fee-profile / binding edits from being clobbered by snapshot
  // refreshes; this effect carves out a narrow exception for *new* accounts
  // so the per-account expandable card and its default-profile <select> both
  // pick up the new id. Updating baseline in lockstep keeps isDirty stable
  // across the merge.
  //
  // KZO-183 extension: when the new account's `feeProfileId` references a
  // profile that does NOT yet exist in `draft.feeProfiles` (the route
  // auto-seeded a default profile alongside the account), additively merge
  // either the real incoming profile payload or a temporary stub bearing
  // that id/accountId. If the real payload arrives while the drawer remains
  // open, replace the untouched stub without clobbering user-edited profiles.
  useEffect(() => {
    if (!open || !wasOpenRef.current) {
      return;
    }

    const mergeFreshAccounts = (model: SettingsFormModel | null) => {
      if (!model) return model;
      const knownAccountIds = new Set(model.accounts.map((account) => account.id));
      const freshAccounts = accounts.filter((account) => !knownAccountIds.has(account.id));
      const incomingProfilesById = new Map(feeProfiles.map((profile) => [profile.id, profile]));
      const accountsById = new Map(accounts.map((account) => [account.id, account]));

      let changed = freshAccounts.length > 0;
      const accountIdsAfterMerge = new Set([
        ...model.accounts.map((account) => account.id),
        ...freshAccounts.map((account) => account.id),
      ]);

      const nextProfiles = model.feeProfiles.map((profile) => {
        const incoming = incomingProfilesById.get(profile.id);
        const account = accountsById.get(profile.accountId);
        if (incoming && account && isAutoSeedProfileStub(profile, account)) {
          changed = true;
          return { ...incoming };
        }
        return profile;
      });

      const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id));
      const incomingAdditions = feeProfiles
        .filter((profile) => accountIdsAfterMerge.has(profile.accountId))
        .filter((profile) => !nextProfileIds.has(profile.id))
        .map((profile) => ({ ...profile }));
      if (incomingAdditions.length > 0) {
        changed = true;
      }

      for (const profile of incomingAdditions) {
        nextProfileIds.add(profile.id);
      }

      const profileStubs = freshAccounts
        .filter((account) => !nextProfileIds.has(account.feeProfileId))
        .map<SettingsProfileModel>((account) => ({
          id: account.feeProfileId,
          accountId: account.id,
          name: "Default Broker",
          boardCommissionRate: 1.425,
          commissionDiscountPercent: 0,
          minimumCommissionAmount: 20,
          commissionCurrency: account.defaultCurrency ?? "TWD",
          commissionRoundingMode: "FLOOR",
          taxRoundingMode: "FLOOR",
          stockSellTaxRateBps: 30,
          stockDayTradeTaxRateBps: 15,
          etfSellTaxRateBps: 10,
          bondEtfSellTaxRateBps: 0,
          commissionChargeMode: "CHARGED_UPFRONT",
        }));
      if (profileStubs.length > 0) {
        changed = true;
      }

      if (!changed) {
        return model;
      }

      return {
        ...model,
        accounts: [
          ...model.accounts,
          ...freshAccounts.map((account) => ({ id: account.id, feeProfileId: account.feeProfileId })),
        ],
        feeProfiles: [
          ...nextProfiles,
          ...incomingAdditions,
          ...profileStubs,
        ],
      };
    };

    setDraft(mergeFreshAccounts);
    setBaseline(mergeFreshAccounts);
  }, [accounts, feeProfiles, open]);

  const isDirty = useMemo(() => {
    if (!draft || !baseline) {
      return false;
    }

    return serializeSettingsForm({
      ...draft,
      quotePollIntervalSeconds: Number(quotePollInterval),
    }) !== serializeSettingsForm(baseline);
  }, [baseline, draft, quotePollInterval]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (isDirty) {
      setShowCloseWarning(true);
      return;
    }

    onOpenChange(false);
  }

  function resetToBaseline() {
    if (!baseline) {
      return;
    }

    setDraft(cloneSettingsForm(baseline));
    setQuotePollInterval(String(baseline.quotePollIntervalSeconds));
    setValidationError("");
    setDiscardNotice(dict.settings.discardedNotice);
  }

  function updateField<K extends keyof SettingsFormModel>(key: K, value: SettingsFormModel[K]) {
    if (!draft) {
      return;
    }
    setDraft({ ...draft, [key]: value });
  }

  function updateProfileField(profileId: string, key: keyof SettingsFormModel["feeProfiles"][number], value: string | number) {
    if (!draft) {
      return;
    }

    setDraft({
      ...draft,
      feeProfiles: draft.feeProfiles.map((profile) => (profile.id === profileId ? { ...profile, [key]: value } : profile)),
    });
  }

  function updateAccountProfile(accountId: string, feeProfileId: string) {
    if (!draft) {
      return;
    }

    setDraft({
      ...draft,
      accounts: draft.accounts.map((account) => (account.id === accountId ? { ...account, feeProfileId } : account)),
    });
  }

  function addBinding(accountId?: string) {
    if (!draft || draft.accounts.length === 0 || draft.feeProfiles.length === 0) {
      return;
    }

    // KZO-183: per-symbol overrides are now scoped to a specific account.
    // Default to the first account; pick the first profile owned by that
    // account so the row's <select> doesn't render with an invalid value.
    const targetAccountId = accountId ?? draft.accounts[0].id;
    const ownedProfile = draft.feeProfiles.find((profile) => profile.accountId === targetAccountId);
    if (!ownedProfile) {
      return;
    }

    setDraft({
      ...draft,
      feeProfileBindings: [
        ...draft.feeProfileBindings,
        {
          accountId: targetAccountId,
          ticker: "2330",
          feeProfileId: ownedProfile.id,
        },
      ],
    });
  }

  function updateBinding(
    index: number,
    patch: Partial<SettingsFormModel["feeProfileBindings"][number]>,
  ) {
    if (!draft) {
      return;
    }

    const nextBindings = [...draft.feeProfileBindings];
    nextBindings[index] = { ...nextBindings[index], ...patch };
    setDraft({ ...draft, feeProfileBindings: nextBindings });
  }

  function removeBinding(index: number) {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      feeProfileBindings: draft.feeProfileBindings.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  function addProfile() {
    if (!draft) {
      return;
    }

    // KZO-183: legacy single-arg addProfile assumes the first account as
    // owner. New code should call `addProfileForAccount(accountId)`.
    const ownerAccountId = draft.accounts[0]?.id ?? "";
    setDraft({
      ...draft,
      feeProfiles: [
        ...draft.feeProfiles,
        { ...createDraftProfile(Date.now(), ownerAccountId), id: newDraftProfileId() },
      ],
    });
  }

  // KZO-183: account-scoped profile actions for the per-account expandable
  // cards. `addProfileForAccount` always tags the new draft profile with
  // the owning account id so the merge-on-grow effect's lookup, the
  // validator's ownership check, and the per-account filter all resolve.
  function addProfileForAccount(accountId: string) {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      feeProfiles: [
        ...draft.feeProfiles,
        { ...createDraftProfile(Date.now(), accountId), id: newDraftProfileId() },
      ],
    });
  }

  function removeProfile(profileId: string) {
    if (!draft) {
      return;
    }

    // KZO-183: per-account "at least one profile" invariant. Block removal
    // when the target profile is the last one owned by its account.
    const target = draft.feeProfiles.find((profile) => profile.id === profileId);
    if (!target) return;
    const ownedByAccount = draft.feeProfiles.filter((profile) => profile.accountId === target.accountId);
    if (ownedByAccount.length <= 1) {
      setValidationError(dict.settings.accountsListAtLeastOneProfile);
      return;
    }

    setDraft(removeProfileFromSettingsForm(draft, profileId));
  }

  function removeProfileFromAccount(accountId: string, profileId: string) {
    if (!draft) return;
    const ownedByAccount = draft.feeProfiles.filter((profile) => profile.accountId === accountId);
    if (ownedByAccount.length <= 1) {
      setValidationError(dict.settings.accountsListAtLeastOneProfile);
      return;
    }
    setDraft(removeProfileFromSettingsForm(draft, profileId));
  }

  /**
   * KZO-183: deep-copy selected profiles from `sourceAccountId` into
   * `targetAccountId`. Each duplicate gets a new client id, the target
   * account's id, and a name suffixed with the source account name (the
   * caller passes through; the hook only enforces structural fields).
   */
  function duplicateProfilesFromAccount(
    sourceAccountId: string,
    targetAccountId: string,
    profileIds: string[],
    sourceAccountName?: string,
  ) {
    if (!draft || profileIds.length === 0) {
      return;
    }
    const selected = draft.feeProfiles.filter(
      (profile) => profile.accountId === sourceAccountId && profileIds.includes(profile.id),
    );
    if (selected.length === 0) return;

    const suffix = sourceAccountName ? ` (from ${sourceAccountName})` : "";
    const duplicates = selected.map<SettingsProfileModel>((profile) => ({
      ...profile,
      id: newDraftProfileId(),
      accountId: targetAccountId,
      name: `${profile.name}${suffix}`,
    }));

    setDraft({
      ...draft,
      feeProfiles: [...draft.feeProfiles, ...duplicates],
    });
  }

  async function handleSubmit() {
    if (!draft) {
      return;
    }

    const nextDraft = normalizeSettingsForm({
      ...draft,
      quotePollIntervalSeconds: Number(quotePollInterval),
    });

    const validation = validateSettingsForm(nextDraft, dict);
    if (validation) {
      setValidationError(validation);
      return;
    }

    setValidationError("");
    setDiscardNotice("");
    await onSave(nextDraft);
  }

  return {
    tab,
    setTab,
    draft,
    quotePollInterval,
    setQuotePollInterval,
    validationError,
    discardNotice,
    showCloseWarning,
    isDirty,
    handleOpenChange,
    resetToBaseline,
    updateField,
    updateProfileField,
    updateAccountProfile,
    addBinding,
    updateBinding,
    removeBinding,
    addProfile,
    addProfileForAccount,
    removeProfile,
    removeProfileFromAccount,
    duplicateProfilesFromAccount,
    setShowCloseWarning,
    setValidationError,
    handleSubmit,
  };
}
