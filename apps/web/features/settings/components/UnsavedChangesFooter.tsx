"use client";

import { AlertTriangle } from "lucide-react";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";

interface UnsavedChangesFooterProps {
  isDirty: boolean;
  showCloseWarning: boolean;
  validationError: string;
  errorMessage: string;
  discardNotice: string;
  isSaving: boolean;
  onKeepEditing: () => void;
  onCancel: () => void;
  onCloseWithoutSaving: () => void;
  onDiscardChanges: () => void;
  dict: AppDictionary;
}

export function UnsavedChangesFooter({
  isDirty,
  showCloseWarning,
  validationError,
  errorMessage,
  discardNotice,
  isSaving,
  onKeepEditing,
  onCancel,
  onCloseWithoutSaving,
  onDiscardChanges,
  dict,
}: UnsavedChangesFooterProps) {
  return (
    <div className="mt-3 shrink-0 space-y-2.5 border-t border-white/10 pt-3 md:mt-4 md:space-y-3 md:pt-4">
      {showCloseWarning && (
        <div
          className="rounded-[18px] border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] px-3 py-3 text-sm text-amber-50"
          data-testid="settings-close-warning"
        >
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <p>{dict.settings.closeWarning}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onKeepEditing}>
              {dict.actions.keepEditing}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCloseWithoutSaving}>
              {dict.actions.closeWithoutSaving}
            </Button>
          </div>
        </div>
      )}

      <p className="glass-inset rounded-[18px] px-3 py-2.5 text-xs text-slate-400">{dict.settings.discardHint}</p>

      {discardNotice && (
        <p
          className="rounded-[18px] border border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.12)] px-3 py-2 text-sm text-emerald-50"
          data-testid="settings-discard-notice"
        >
          {discardNotice}
        </p>
      )}

      {(validationError || errorMessage) && (
        <p
          className="rounded-[18px] border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.12)] px-3 py-2 text-sm text-rose-100"
          data-testid="settings-validation-error"
        >
          {validationError || errorMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDiscardChanges}
          disabled={isSaving || !isDirty}
          data-testid="settings-discard-button"
        >
          {dict.actions.discardChanges}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
          {dict.actions.cancel}
        </Button>
        <Button type="submit" disabled={isSaving || !isDirty} data-testid="settings-save-button">
          {isSaving ? dict.actions.savingSettings : dict.actions.saveSettings}
        </Button>
      </div>
    </div>
  );
}
