"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { AccountDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import type { SettingsAccountBindingModel, SettingsProfileModel } from "../types/settingsUi";

interface AccountFallbackSectionProps {
  accounts: AccountDto[];
  bindings: SettingsAccountBindingModel[];
  profiles: SettingsProfileModel[];
  onUpdateAccountProfile: (accountId: string, feeProfileId: string) => void;
  onRenameAccount: (accountId: string, name: string) => Promise<void>;
  dict: AppDictionary;
}

export function AccountFallbackSection({
  accounts,
  bindings,
  profiles,
  onUpdateAccountProfile,
  onRenameAccount,
  dict,
}: AccountFallbackSectionProps) {
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renameOverrides, setRenameOverrides] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");

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
    if (!trimmedName) {
      return;
    }

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

  return (
    <section className="glass-inset space-y-3 rounded-[24px] p-4">
      <h3 className="text-lg font-semibold text-ink">{dict.settings.accountFallbackSectionTitle}</h3>
      <p className="text-xs text-slate-400">{dict.settings.accountFallbackSectionDescription}</p>
      {renameError ? <p className="text-xs text-rose-500">{renameError}</p> : null}

      <div className="space-y-2">
        {accounts.map((account) => {
          const draftAccount = bindings.find((item) => item.id === account.id);
          const displayName = accountNames.get(account.id) ?? account.name;
          const isEditing = editingAccountId === account.id;
          const isSaving = savingAccountId === account.id;
          const disableRenameSave = draftName.trim().length === 0 || isSaving;

          return (
            <div key={account.id} className="grid gap-3 rounded-[18px] border border-white/10 bg-slate-950/35 p-3 text-sm lg:grid-cols-[1fr_220px]">
              <div className="space-y-3">
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
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink" data-testid="account-name-label">{displayName}</p>
                      <p className="text-xs text-slate-400">{account.id}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startRename(account)}
                      className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:border-white/20 hover:text-white"
                      data-testid="account-rename-icon"
                      aria-label={dict.settings.accountRenameIconLabel}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
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
