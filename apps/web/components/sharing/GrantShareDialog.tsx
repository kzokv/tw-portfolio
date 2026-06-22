"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Mail, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocaleCode, ShareCapability } from "@vakwen/shared-types";
import { ApiError } from "../../lib/api";
import { createShareGrant, resolveInviteUrl } from "../../features/sharing/service";
import { ASSIGNABLE_SHARE_CAPABILITIES } from "../../features/sharing/capabilities";
import type { GrantShareResult } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";

interface GrantShareDialogProps {
  open: boolean;
  locale: LocaleCode;
  initialEmail?: string;
  allowedCapabilities?: ShareCapability[];
  onOpenChange: (open: boolean) => void;
  onCreated: (result: GrantShareResult) => Promise<void> | void;
}

type GrantStep = "form" | "confirm" | "success";

const CAPABILITY_LABELS: Record<ShareCapability, string> = {
  "portfolio:mcp_read": "App read",
  "account:manage": "Account manage",
  "sharing:manage": "Share manage",
  "transaction_draft:create": "Draft create",
  "transaction_draft:edit": "Draft edit",
  "transaction_draft:archive": "Draft archive",
  "transaction_draft:delete": "Draft delete",
  "transaction:write": "Transaction write",
};

const PRESETS: Array<{
  key: keyof ReturnType<typeof getDictionary>["sharing"]["grantDialog"]["presets"];
  capabilities: ShareCapability[];
}> = [
  { key: "viewer", capabilities: [] },
  { key: "aiViewer", capabilities: ["portfolio:mcp_read"] },
  { key: "draftCollaborator", capabilities: ["portfolio:mcp_read", "transaction_draft:create", "transaction_draft:edit"] },
  { key: "delegateManager", capabilities: ["portfolio:mcp_read", "account:manage", "sharing:manage", "transaction:write"] },
  { key: "fullDelegate", capabilities: [...ASSIGNABLE_SHARE_CAPABILITIES] },
];

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
  allowedCapabilities,
  onOpenChange,
  onCreated,
}: GrantShareDialogProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const capabilityOptions = allowedCapabilities ?? ASSIGNABLE_SHARE_CAPABILITIES;
  const [step, setStep] = useState<GrantStep>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ShareCapability[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingResult, setPendingResult] = useState<Extract<GrantShareResult, { type: "pending" }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setEmail(initialEmail ?? "");
    setCapabilities([]);
    setError(null);
    setIsSubmitting(false);
    setCopied(false);
    setPendingResult(null);
  }, [initialEmail, open]);

  async function handleCreateShare() {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createShareGrant(email, capabilities);
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

  function toggleCapability(capability: ShareCapability, checked: boolean) {
    setCapabilities((current) =>
      checked
        ? [...new Set([...current, capability])]
        : current.filter((item) => item !== capability),
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/80" />
        <Dialog.Content
          className="!fixed left-1/2 top-1/2 z-[71] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none sm:p-6"
          data-testid="grant-share-dialog"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">
                {step === "success" ? dict.sharing.grantDialog.successTitle : dict.sharing.grantDialog.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
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

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-700">{dict.sharing.grantDialog.permissionsTitle}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                      onClick={() => {
                        setCapabilities(preset.capabilities.filter((capability) => capabilityOptions.includes(capability)));
                      }}
                    >
                      {dict.sharing.grantDialog.presets[preset.key]}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {capabilityOptions.map((capability) => (
                    <label key={capability} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      <span>{dict.sharing.capabilityLabels[capability] ?? CAPABILITY_LABELS[capability]}</span>
                      <input
                        type="checkbox"
                        checked={capabilities.includes(capability)}
                        onChange={(event) => toggleCapability(capability, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              </div>

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
                <p className="mt-2 text-sm text-slate-600">
                  {capabilities.length === 0
                    ? dict.sharing.editPermissionsDialog.readOnlySummary
                    : capabilities.map((capability) => dict.sharing.capabilityLabels[capability] ?? CAPABILITY_LABELS[capability]).join(", ")}
                </p>
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
