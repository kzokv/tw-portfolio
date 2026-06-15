"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LocaleCode, ShareCapability, UserRole } from "@vakwen/shared-types";
import { ApiError } from "../../lib/api";
import {
  fetchSharingPageData,
  resolveInviteUrl,
  revokeActiveShare,
  revokePendingShare,
  updateActiveShareCapabilities,
  updatePendingShareCapabilities,
} from "../../features/sharing/service";
import type { GrantShareResult, OutboundShareRow, SharingPageData } from "../../features/sharing/types";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../ui/Tabs";
import { GrantShareDialog } from "./GrantShareDialog";
import { EditSharePermissionsDialog } from "./EditSharePermissionsDialog";
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

type SharingTab = "outbound" | "inbound" | "anonymous";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<SharingPageData>(EMPTY_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<SharingFlashMessage | null>(null);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantInitialEmail, setGrantInitialEmail] = useState<string | undefined>(undefined);
  const [revokeTarget, setRevokeTarget] = useState<OutboundShareRow | null>(null);
  const [editTarget, setEditTarget] = useState<OutboundShareRow | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditingPermissions, setIsEditingPermissions] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [anonymousActiveCount, setAnonymousActiveCount] = useState(0);

  const canGrant = !isDemo && role !== "viewer";
  const activeTab = normalizeSharingTab(searchParams?.get("tab"), canGrant, isDemo);
  const outboundCount = data.outbound.active.length + data.outbound.pending.length + data.outbound.expired.length;
  const inboundCount = data.inbound.active.length + data.inbound.revoked.length;

  function handleTabChange(next: string) {
    const tab = normalizeSharingTab(next, canGrant, isDemo);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "outbound") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.replace(query ? `/sharing?${query}` : "/sharing", { scroll: false });
  }

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

  async function handleSavePermissions(row: OutboundShareRow, capabilities: ShareCapability[]) {
    setIsEditingPermissions(true);
    setEditError(null);
    setMessage(null);
    try {
      if (row.shareId) {
        await updateActiveShareCapabilities(row.shareId, capabilities);
      } else if (row.inviteCode) {
        await updatePendingShareCapabilities(row.inviteCode, capabilities);
      } else {
        throw new Error("Missing share identifier");
      }
      setEditTarget(null);
      await loadData();
      setMessage({ tone: "success", text: dict.sharing.editPermissionsDialog.saveLabel });
    } catch {
      setEditError(dict.sharing.editPermissionsDialog.error);
    } finally {
      setIsEditingPermissions(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="sharing-page">
      <Card className="space-y-4 rounded-[20px] px-5 py-5 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {dict.sharing.pageEyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{dict.sharing.pageTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{dict.sharing.pageIntro}</p>
          </div>

          <div className="flex flex-wrap gap-2">
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
            className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600"
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
              ? "rounded-[18px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700"
              : "rounded-[18px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
          }
          role="status"
          aria-live="polite"
          data-testid="sharing-flash-message"
        >
          {message.text}
        </p>
      ) : null}

	      {isLoading ? (
	        <Card className="flex items-center justify-center py-12" data-testid="sharing-loading">
	          <p className="text-sm text-slate-500">{dict.sharing.loading}</p>
	        </Card>
      ) : error ? (
        <Card className="flex flex-col items-center justify-center gap-4 py-12" data-testid="sharing-error">
          <p className="text-sm text-rose-600">{error || dict.sharing.loadError}</p>
          <Button variant="secondary" onClick={() => void loadData()}>
            {dict.sharing.actions.retry}
          </Button>
        </Card>
	      ) : (
	        <TabsRoot value={activeTab} onValueChange={handleTabChange} data-testid="sharing-tabs">
	          <TabsList className="w-full justify-start rounded-[18px] bg-slate-100/80">
	            <TabsTrigger value="outbound" disabled={!canGrant} data-testid="sharing-tab-outbound">
	              {dict.sharing.tabs.outbound} ({outboundCount})
	            </TabsTrigger>
	            <TabsTrigger value="inbound" data-testid="sharing-tab-inbound">
	              {dict.sharing.tabs.inbound} ({inboundCount})
	            </TabsTrigger>
	            <TabsTrigger value="anonymous" disabled={isDemo} data-testid="sharing-tab-anonymous">
	              {dict.sharing.tabs.anonymous} ({anonymousActiveCount})
	            </TabsTrigger>
	          </TabsList>

	          <TabsContent value="outbound" data-testid="sharing-panel-outbound">
	            {canGrant ? (
	              <OutboundSharesTable
	                locale={locale}
	                outbound={data.outbound}
	                showHistory={showHistory}
	                onToggleHistory={() => setShowHistory((current) => !current)}
	                onCopyUrl={(row) => void handleCopyUrl(row)}
	                onEditPermissions={(row) => {
	                  setEditError(null);
	                  setEditTarget(row);
	                }}
	                onRevoke={setRevokeTarget}
	                onReshare={(row) => {
	                  setGrantInitialEmail(row.email);
	                  setGrantDialogOpen(true);
	                }}
	              />
	            ) : (
	              <Card className="rounded-[20px] px-5 py-5 text-sm text-slate-600">
	                {isDemo ? dict.sharing.inboundOnlyDemo : dict.sharing.inboundOnlyViewer}
	              </Card>
	            )}
	          </TabsContent>

	          <TabsContent value="inbound" data-testid="sharing-panel-inbound">
	            <InboundSharesCards locale={locale} inbound={data.inbound} />
	          </TabsContent>

	          <TabsContent value="anonymous" data-testid="sharing-panel-anonymous">
	            {!isDemo ? (
	              <PublicLinksSection locale={locale} onActiveCountChange={setAnonymousActiveCount} />
	            ) : (
	              <Card className="rounded-[20px] px-5 py-5 text-sm text-slate-600">
	                {dict.sharing.inboundOnlyDemo}
	              </Card>
	            )}
	          </TabsContent>
	        </TabsRoot>
	      )}

      <GrantShareDialog
        open={grantDialogOpen}
        locale={locale}
        initialEmail={grantInitialEmail}
        onOpenChange={setGrantDialogOpen}
        onCreated={handleCreated}
      />
      <EditSharePermissionsDialog
        open={editTarget !== null}
        locale={locale}
        row={editTarget}
        isSubmitting={isEditingPermissions}
        error={editError}
        onSave={(row, capabilities) => void handleSavePermissions(row, capabilities)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setEditError(null);
          }
        }}
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

function normalizeSharingTab(value: string | null, canGrant: boolean, isDemo: boolean): SharingTab {
  if (value === "inbound") return "inbound";
  if (value === "anonymous" && !isDemo) return "anonymous";
  if (value === "outbound" && canGrant) return "outbound";
  return canGrant ? "outbound" : "inbound";
}
