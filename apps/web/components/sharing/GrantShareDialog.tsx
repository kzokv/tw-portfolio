"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Mail, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { ApiError } from "../../lib/api";
import { createShareGrant, resolveInviteUrl } from "../../features/sharing/service";
import type { GrantShareResult } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";

interface GrantShareDialogProps {
  open: boolean;
  locale: LocaleCode;
  initialEmail?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: GrantShareResult) => Promise<void> | void;
}

type GrantStep = "form" | "confirm" | "success";

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapErrorMessage(error: unknown, dict: ReturnType<typeof getDictionary>["sharing"]["errors"]): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "share_grant_forbidden":
        return dict.forbidden;
      case "cannot_share_with_self":
        return dict.selfShare;
      case "share_invite_rate_limited":
        return dict.rateLimited;
      default:
        return error.message || dict.generic;
    }
  }
  return dict.generic;
}

export function GrantShareDialog({
  open,
  locale,
  initialEmail,
  onOpenChange,
  onCreated,
}: GrantShareDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const [step, setStep] = useState<GrantStep>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingResult, setPendingResult] = useState<Extract<GrantShareResult, { type: "pending" }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setEmail(initialEmail ?? "");
    setError(null);
    setIsSubmitting(false);
    setCopied(false);
    setPendingResult(null);
  }, [initialEmail, open]);

  async function handleCreateShare() {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createShareGrant(email);
      await onCreated(result);
      if (result.type === "pending") {
        setPendingResult(result);
        setStep("success");
        return;
      }
      onOpenChange(false);
    } catch (nextError) {
      setError(mapErrorMessage(nextError, dict.sharing.errors));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyInviteUrl() {
    const inviteUrl = pendingResult ? resolveInviteUrl(pendingResult.inviteCode, pendingResult.inviteUrl) : null;
    if (!inviteUrl) {
      setError(dict.sharing.errors.copyFailed);
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError(dict.sharing.errors.copyFailed);
    }
  }

  const inviteUrl = pendingResult ? resolveInviteUrl(pendingResult.inviteCode, pendingResult.inviteUrl) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/82" />
        <Dialog.Content
          className="glass-panel !fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-5 shadow-glass focus:outline-none sm:p-6"
          data-testid="grant-share-dialog"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-slate-950">
                {step === "success" ? dict.sharing.grantDialog.successTitle : dict.sharing.grantDialog.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">
                {step === "confirm"
                  ? dict.sharing.grantDialog.confirmDescription.replace("{email}", email)
                  : step === "success"
                    ? dict.sharing.grantDialog.successDescription.replace("{email}", pendingResult?.email ?? email)
                    : dict.sharing.grantDialog.description}
              </Dialog.Description>
            </div>
            <button
              type="button"
              className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={dict.actions.cancel}
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {step === "form" ? (
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const nextEmail = email.trim().toLowerCase();
                if (!isLikelyEmail(nextEmail)) {
                  setError(dict.sharing.errors.invalidEmail);
                  return;
                }
                setEmail(nextEmail);
                setError(null);
                setStep("confirm");
              }}
            >
              <label className="block text-sm font-medium text-slate-700">
                {dict.sharing.grantDialog.emailLabel}
                <div className="mt-2 flex items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={dict.sharing.grantDialog.emailPlaceholder}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none"
                    autoFocus
                    data-testid="grant-share-email-input"
                  />
                </div>
              </label>

              {error ? (
                <p className="text-sm text-rose-600" role="alert" data-testid="grant-share-error">{error}</p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  {dict.actions.cancel}
                </Button>
                <Button type="submit" data-testid="grant-share-continue">
                  {dict.sharing.grantDialog.continueLabel}
                </Button>
              </div>
            </form>
          ) : null}

          {step === "confirm" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {dict.sharing.grantDialog.confirmTitle}
                </p>
                <p className="mt-2 text-base font-semibold text-slate-950">{email}</p>
              </div>

              {error ? (
                <p className="text-sm text-rose-600" role="alert" data-testid="grant-share-error">{error}</p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setStep("form")} disabled={isSubmitting}>
                  {dict.actions.cancel}
                </Button>
                <Button onClick={() => void handleCreateShare()} disabled={isSubmitting} data-testid="grant-share-confirm">
                  {isSubmitting ? dict.sharing.grantDialog.submittingLabel : dict.sharing.grantDialog.confirmAction}
                </Button>
              </div>
            </div>
          ) : null}

          {step === "success" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/80 px-4 py-4 text-sm text-emerald-700">
                {dict.sharing.grantDialog.pendingSuccess.replace("{email}", pendingResult?.email ?? email)}
              </div>

              <label className="block text-sm font-medium text-slate-700">
                {dict.sharing.grantDialog.urlLabel}
                <div className="mt-2 flex items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                  <input
                    type="text"
                    readOnly
                    value={inviteUrl ?? ""}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none"
                    data-testid="grant-share-invite-url"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleCopyInviteUrl()}
                    data-testid="grant-share-copy-url"
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? dict.sharing.grantDialog.copiedLabel : dict.sharing.grantDialog.copyLabel}
                  </Button>
                </div>
              </label>

              {error ? (
                <p className="text-sm text-rose-600" role="alert" data-testid="grant-share-error">{error}</p>
              ) : null}

              <div className="flex justify-end">
                <Button onClick={() => onOpenChange(false)} data-testid="grant-share-done">
                  {dict.sharing.grantDialog.doneLabel}
                </Button>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
