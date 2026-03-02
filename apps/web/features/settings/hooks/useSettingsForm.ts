"use client";

import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    if (!open || !settings) {
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
  }, [accounts, feeProfileBindings, feeProfiles, open, settings]);

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
          symbol: "2330",
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
