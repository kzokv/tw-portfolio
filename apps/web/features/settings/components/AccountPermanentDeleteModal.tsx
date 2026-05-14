"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import type { AccountDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";

/**
 * ui-enhancement (2026-05-13) — typed-name confirmation modal for
 * `POST /accounts/:id/purge`. Mirrors the admin `hardPurgeUser` UX —
 * the Confirm button is disabled until the typed input strictly equals
 * the account's `name`.
 *
 * Used in two flows:
 *  1. From an active account row's Delete dropdown — "Permanently delete
 *     now" (skip the 30-day grace window).
 *  2. From the Recently-deleted subsection's per-row purge button —
 *     advance an already-soft-deleted row to hard-purge immediately.
 *
 * Confirm hands the typed name back to the parent so the parent can
 * forward it as `{ confirmationName }` in the POST body.
 *
 * Testids locked per `architect-design.md` §9.
 */
interface AccountPermanentDeleteModalProps {
  open: boolean;
  account: AccountDto | null;
  busy: boolean;
  error?: string;
  onConfirm: (typedName: string) => void;
  onCancel: () => void;
  dict: AppDictionary;
}

export function AccountPermanentDeleteModal({
  open,
  account,
  busy,
  error,
  onConfirm,
  onCancel,
  dict,
}: AccountPermanentDeleteModalProps) {
  const [typedName, setTypedName] = useState("");

  // Reset typed input each time the modal opens for a different account.
  useEffect(() => {
    if (open) setTypedName("");
  }, [open, account?.id]);

  if (!account) return null;

  const confirmDisabled = busy || typedName !== account.name;

  // ui-enhancement (2026-05-13) — render WITHOUT Dialog.Portal so unit
  // tests scoped to `container` (not `document`) can locate the modal.
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <Dialog.Overlay
        className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm data-[state=open]:animate-fade-in-up"
      />
      <Dialog.Content
        aria-describedby={undefined}
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-rose-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.18)] focus:outline-none"
        data-testid="account-permanent-delete-modal"
      >
          <Dialog.Title className="text-lg font-semibold text-rose-700">
            {dict.settings.accountsPermanentDeleteModalTitle}
          </Dialog.Title>
          <p className="mt-2 text-sm text-slate-700">
            {dict.settings.accountsPermanentDeleteModalBody}
          </p>

          <label className="mt-4 block space-y-2 text-xs text-slate-600">
            <span>
              {dict.settings.accountsPermanentDeleteInputLabel.replace(
                "{name}",
                account.name,
              )}
            </span>
            <input
              type="text"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              className={fieldClassName}
              autoComplete="off"
              autoFocus
              data-testid="account-permanent-delete-input"
            />
          </label>

          {error ? (
            <p className="mt-3 text-xs text-rose-600" role="alert">{error}</p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCancel}
              disabled={busy}
              data-testid="account-permanent-delete-cancel-btn"
            >
              {dict.settings.accountsPermanentDeleteCancel}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onConfirm(typedName)}
              disabled={confirmDisabled}
              data-testid="account-permanent-delete-confirm-btn"
            >
              {dict.settings.accountsPermanentDeleteConfirm}
            </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
