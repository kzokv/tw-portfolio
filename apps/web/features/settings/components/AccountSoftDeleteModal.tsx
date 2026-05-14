"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { AccountDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";

/**
 * ui-enhancement (2026-05-13) — confirmation modal for `DELETE /accounts/:id`.
 *
 * Renders the configurable warnings (open positions / non-zero cash /
 * last-account) only when the consumer flags them as applicable. Confirm
 * triggers the parent's `onConfirm` callback; the parent is responsible
 * for awaiting the network call and closing the modal on success.
 *
 * Testids locked per `architect-design.md` §9.
 */
export interface AccountSoftDeleteWarnings {
  hasOpenPositions: boolean;
  hasNonZeroCash: boolean;
  isLastActiveAccount: boolean;
}

interface AccountSoftDeleteModalProps {
  open: boolean;
  account: AccountDto | null;
  warnings: AccountSoftDeleteWarnings;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  dict: AppDictionary;
}

export function AccountSoftDeleteModal({
  open,
  account,
  warnings,
  busy,
  error,
  onConfirm,
  onCancel,
  dict,
}: AccountSoftDeleteModalProps) {
  if (!account) return null;

  const anyWarning =
    warnings.hasOpenPositions
    || warnings.hasNonZeroCash
    || warnings.isLastActiveAccount;

  // ui-enhancement (2026-05-13) — render WITHOUT Dialog.Portal so the
  // modal lives inside the component's testing-library subtree. The
  // `Dialog.Root` + `Dialog.Content` pair still provides aria-modal
  // semantics, focus-trap, and Esc-to-close; the portal only affects DOM
  // attachment point. Unit tests scope queries to `container` rather
  // than `document`, so an inline render is the cleaner contract.
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <Dialog.Overlay
        className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm data-[state=open]:animate-fade-in-up"
      />
      <Dialog.Content
        aria-describedby={undefined}
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.18)] focus:outline-none"
        data-testid="account-soft-delete-modal"
      >
          <Dialog.Title className="text-lg font-semibold text-slate-950">
            {dict.settings.accountsSoftDeleteModalTitle}
          </Dialog.Title>
          <p className="mt-2 text-sm text-slate-600">
            {dict.settings.accountsSoftDeleteModalBody}
          </p>

          {anyWarning ? (
            <ul
              className="mt-4 space-y-2 rounded-[14px] border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800"
              data-testid="account-soft-delete-warnings"
            >
              {warnings.hasOpenPositions ? (
                <li data-testid="account-soft-delete-warning-open-positions">
                  {dict.settings.accountsSoftDeleteWarningOpenPositions}
                </li>
              ) : null}
              {warnings.hasNonZeroCash ? (
                <li data-testid="account-soft-delete-warning-cash-balance">
                  {dict.settings.accountsSoftDeleteWarningCashBalance}
                </li>
              ) : null}
              {warnings.isLastActiveAccount ? (
                <li data-testid="account-soft-delete-warning-last-account">
                  {dict.settings.accountsSoftDeleteWarningLastAccount}
                </li>
              ) : null}
            </ul>
          ) : null}

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
            data-testid="account-soft-delete-cancel-btn"
          >
            {dict.settings.accountsSoftDeleteCancel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            data-testid="account-soft-delete-confirm-btn"
          >
            {dict.settings.accountsSoftDeleteConfirm}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
