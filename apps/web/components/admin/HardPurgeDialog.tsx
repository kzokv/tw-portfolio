"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { useAdminI18n } from "./admin-i18n";

interface HardPurgeDialogProps {
  open: boolean;
  targetEmail: string;
  adminEmail: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: (confirmation: string, adminEmail: string) => void;
  onCancel: () => void;
}

export function HardPurgeDialog({
  open,
  targetEmail,
  adminEmail,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: HardPurgeDialogProps) {
  const dict = useAdminI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [purgeInput, setPurgeInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  const expectedPurge = `PURGE ${targetEmail}`;
  const purgeValid = purgeInput === expectedPurge;
  const emailValid = emailInput === adminEmail;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setPurgeInput("");
      setEmailInput("");
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="m-auto max-w-md rounded-2xl border border-red-200 bg-white p-0 shadow-[0_20px_60px_rgba(220,38,38,0.15)] backdrop:bg-slate-950/40"
      data-testid="hard-purge-dialog"
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold text-red-900">{dict.hardPurge.title}</h2>
        <p className="mt-2 text-sm text-red-700">
          {dict.hardPurge.bodyPrefix} <strong>{targetEmail}</strong>{dict.hardPurge.bodySuffix}
        </p>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="purge-error">
            {error}
          </p>
        )}

        {step === 1 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700">
              {dict.hardPurge.type} <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono">{expectedPurge}</code> {dict.hardPurge.toContinue}
            </label>
            <input
              value={purgeInput}
              onChange={(e) => setPurgeInput(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder={expectedPurge}
              data-testid="purge-confirmation-input"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={onCancel}>
                {dict.common.cancel}
              </Button>
              <Button
                size="sm"
                className="border-red-300 bg-red-600 shadow-red-200/40 hover:bg-red-700"
                disabled={!purgeValid}
                onClick={() => setStep(2)}
                data-testid="purge-step1-next"
              >
                {dict.hardPurge.next}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700">
              {dict.hardPurge.typeYourEmail} <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono">{adminEmail}</code> {dict.hardPurge.toConfirm}
            </label>
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder={adminEmail}
              data-testid="purge-email-input"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={() => setStep(1)} disabled={loading}>
                {dict.hardPurge.back}
              </Button>
              <Button
                size="sm"
                className="border-red-300 bg-red-600 shadow-red-200/40 hover:bg-red-700"
                disabled={!emailValid || loading}
                onClick={() => onConfirm(expectedPurge, emailInput)}
                data-testid="purge-confirm-button"
              >
                {loading ? dict.hardPurge.purging : dict.hardPurge.confirm}
              </Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
