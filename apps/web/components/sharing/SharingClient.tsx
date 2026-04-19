"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocaleCode, UserRole } from "@tw-portfolio/shared-types";
import { ApiError } from "../../lib/api";
import {
  fetchSharingPageData,
  resolveInviteUrl,
  revokeActiveShare,
  revokePendingShare,
} from "../../features/sharing/service";
import type { GrantShareResult, OutboundShareRow, SharingPageData } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { GrantShareDialog } from "./GrantShareDialog";
import { InboundSharesCards } from "./InboundSharesCards";
import { OutboundSharesTable } from "./OutboundSharesTable";
import { PublicLinksSection } from "./PublicLinksSection";
import { ShareRevokeDialog } from "./ShareRevokeDialog";

interface SharingClientProps {
  locale: LocaleCode;
  isDemo: boolean;
  role: UserRole;
}

interface SharingFlashMessage {
  tone: "success" | "error";
  text: string;
}

const EMPTY_DATA: SharingPageData = {
  outbound: {
    active: [],
    pending: [],
    expired: [],
    revoked: [],
  },
  inbound: {
    active: [],
    revoked: [],
  },
};

function mapErrorMessage(error: unknown, dict: ReturnType<typeof getDictionary>["sharing"]["errors"]): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "share_grant_forbidden":
        return dict.forbidden;
      case "cannot_share_with_self":
        return dict.selfShare;
      case "share_invite_rate_limited":
        return dict.rateLimited;
      case "validation_error":
        return dict.invalidEmail;
      default:
        return error.message || dict.generic;
    }
  }

  return dict.generic;
}

export function SharingClient({ locale, isDemo, role }: SharingClientProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const [data, setData] = useState<SharingPageData>(EMPTY_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<SharingFlashMessage | null>(null);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantInitialEmail, setGrantInitialEmail] = useState<string | undefined>(undefined);
  const [revokeTarget, setRevokeTarget] = useState<OutboundShareRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const canGrant = !isDemo && role !== "viewer";

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextData = await fetchSharingPageData();
      setData(nextData);
    } catch (nextError) {
      setError(mapErrorMessage(nextError, dict.sharing.errors));
    } finally {
      setIsLoading(false);
    }
  }, [dict.sharing.errors]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreated(result: GrantShareResult) {
    await loadData();
    setMessage({
      tone: "success",
      text: result.type === "resolved"
        ? dict.sharing.grantDialog.resolvedSuccess.replace("{email}", result.email)
        : dict.sharing.grantDialog.pendingSuccess.replace("{email}", result.email),
    });
  }

  async function handleCopyUrl(row: OutboundShareRow) {
    const inviteUrl = resolveInviteUrl(row.inviteCode, row.inviteUrl);
    if (!inviteUrl) {
      setMessage({ tone: "error", text: dict.sharing.errors.copyFailed });
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage({ tone: "success", text: dict.sharing.grantDialog.copiedLabel });
    } catch {
      setMessage({ tone: "error", text: dict.sharing.errors.copyFailed });
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;

    setIsRevoking(true);
    setMessage(null);
    try {
      if (revokeTarget.shareId) {
        await revokeActiveShare(revokeTarget.shareId);
      } else if (revokeTarget.inviteCode) {
        await revokePendingShare(revokeTarget.inviteCode);
      }

      setRevokeTarget(null);
      await loadData();
    } catch (nextError) {
      setMessage({
        tone: "error",
        text: mapErrorMessage(nextError, dict.sharing.errors),
      });
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="sharing-page">
      <Card className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {dict.sharing.pageEyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950">{dict.sharing.pageTitle}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{dict.sharing.pageIntro}</p>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void loadData()} data-testid="sharing-refresh-button">
              {dict.sharing.refreshButton}
            </Button>
            {canGrant ? (
              <Button
                onClick={() => {
                  setGrantInitialEmail(undefined);
                  setGrantDialogOpen(true);
                }}
                data-testid="sharing-grant-button"
              >
                {dict.sharing.grantButton}
              </Button>
            ) : null}
          </div>
        </div>

        {!canGrant ? (
          <div
            className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600"
            data-testid="sharing-role-note"
          >
            {isDemo ? dict.sharing.inboundOnlyDemo : dict.sharing.inboundOnlyViewer}
          </div>
        ) : null}
      </Card>

      {message ? (
        <p
          className={
            message.tone === "success"
              ? "rounded-[22px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700"
              : "rounded-[22px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
          }
          role="status"
          aria-live="polite"
          data-testid="sharing-flash-message"
        >
          {message.text}
        </p>
      ) : null}

      {isLoading ? (
        <Card className="flex items-center justify-center py-16" data-testid="sharing-loading">
          <p className="text-sm text-slate-500">{dict.sharing.loading}</p>
        </Card>
      ) : error ? (
        <Card className="flex flex-col items-center justify-center gap-4 py-16" data-testid="sharing-error">
          <p className="text-sm text-rose-600">{error || dict.sharing.loadError}</p>
          <Button variant="secondary" onClick={() => void loadData()}>
            {dict.sharing.actions.retry}
          </Button>
        </Card>
      ) : (
        <>
          {canGrant ? (
            <OutboundSharesTable
              locale={locale}
              outbound={data.outbound}
              showHistory={showHistory}
              onToggleHistory={() => setShowHistory((current) => !current)}
              onCopyUrl={(row) => void handleCopyUrl(row)}
              onRevoke={setRevokeTarget}
              onReshare={(row) => {
                setGrantInitialEmail(row.email);
                setGrantDialogOpen(true);
              }}
            />
          ) : null}

          <InboundSharesCards locale={locale} inbound={data.inbound} />

          {!isDemo ? <PublicLinksSection locale={locale} /> : null}
        </>
      )}

      <GrantShareDialog
        open={grantDialogOpen}
        locale={locale}
        initialEmail={grantInitialEmail}
        onOpenChange={setGrantDialogOpen}
        onCreated={handleCreated}
      />
      <ShareRevokeDialog
        open={revokeTarget !== null}
        row={revokeTarget}
        locale={locale}
        isSubmitting={isRevoking}
        onConfirm={() => void handleConfirmRevoke()}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      />
    </div>
  );
}
