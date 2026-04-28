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
import type { SettingsFormModel, SettingsTab } from "../types/settingsUi";
import { validateSettingsForm } from "../validators/settingsValidation";

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

  // KZO-182: While the drawer is open, additively merge newly-arrived
  // accounts (e.g. created via AccountCreateForm → dashboard.refresh) into
  // both draft and baseline. The closed→open seed guard above protects
  // in-progress fee-profile / binding edits from being clobbered by snapshot
  // refreshes; this effect carves out a narrow exception for *new* accounts
  // so AccountsListSection's per-row fee-profile <select> and the Fees-tab
  // Add-Override default both pick up the new id. Updating baseline in
  // lockstep keeps isDirty stable across the merge.
  useEffect(() => {
    if (!open || !wasOpenRef.current) {
      return;
    }

    const mergeNewAccounts = (model: SettingsFormModel | null) => {
      if (!model) return model;
      const known = new Set(model.accounts.map((account) => account.id));
      const fresh = accounts.filter((account) => !known.has(account.id));
      if (fresh.length === 0) return model;
      return {
        ...model,
        accounts: [
          ...model.accounts,
          ...fresh.map((account) => ({ id: account.id, feeProfileId: account.feeProfileId })),
        ],
      };
    };

    setDraft(mergeNewAccounts);
    setBaseline(mergeNewAccounts);
  }, [accounts, open]);

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

  function addBinding() {
    if (!draft || draft.accounts.length === 0 || draft.feeProfiles.length === 0) {
      return;
    }

    setDraft({
      ...draft,
      feeProfileBindings: [
        ...draft.feeProfileBindings,
        {
          accountId: draft.accounts[0].id,
          ticker: "2330",
          feeProfileId: draft.feeProfiles[0].id,
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

    setDraft({
      ...draft,
      feeProfiles: [...draft.feeProfiles, createDraftProfile(Date.now())],
    });
  }

  function removeProfile(profileId: string) {
    if (!draft) {
      return;
    }

    if (draft.feeProfiles.length <= 1) {
      setValidationError(dict.settings.validationAtLeastOneProfile);
      return;
    }

    setDraft(removeProfileFromSettingsForm(draft, profileId));
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
    removeProfile,
    setShowCloseWarning,
    setValidationError,
    handleSubmit,
  };
}
