"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnonymousShareTokenDto, LocaleCode } from "@vakwen/shared-types";
import {
  ApiError,
  createAnonymousToken,
  listAnonymousTokens,
  revokeAnonymousToken,
} from "../../lib/api";
import { getDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { AnonymousLinksTable } from "./AnonymousLinksTable";
import { CreateAnonymousLinkDialog } from "./CreateAnonymousLinkDialog";
import { RevokeAnonymousLinkDialog } from "./RevokeAnonymousLinkDialog";

interface PublicLinksSectionProps {
  locale: LocaleCode;
}

const ACTIVE_CAP = 20;
const COPY_FEEDBACK_MS = 10_000;
const TRANSIENT_STATE_MS = 10_000;

function mapCreateError(error: unknown, copy: ReturnType<typeof getDictionary>["sharing"]["publicLinks"]["errors"]): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "anonymous_token_cap_exceeded":
        return copy.capExceeded;
      case "share_grant_forbidden":
        return copy.forbidden;
      case "write_blocked_viewing_shared":
        return copy.writeBlocked;
      case "rate_limit_exceeded":
        return copy.rateLimited;
      case "validation_error":
        return copy.validation;
      default:
        return error.message || copy.generic;
    }
  }
  return copy.generic;
}

function mapRevokeError(error: unknown, copy: ReturnType<typeof getDictionary>["sharing"]["publicLinks"]["errors"]): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "share_grant_forbidden":
        return copy.forbidden;
      case "write_blocked_viewing_shared":
        return copy.writeBlocked;
      case "rate_limit_exceeded":
        return copy.rateLimited;
      default:
        return error.message || copy.generic;
    }
  }
  return copy.generic;
}

export function PublicLinksSection({ locale }: PublicLinksSectionProps) {
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const copy = dict.sharing.publicLinks;

  const [tokens, setTokens] = useState<AnonymousShareTokenDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AnonymousShareTokenDto | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [capErrorText, setCapErrorText] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [copyAffordanceId, setCopyAffordanceId] = useState<string | null>(null);
  const [copyFeedbackId, setCopyFeedbackId] = useState<string | null>(null);
  const newBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAffordanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current);
      if (copyAffordanceTimerRef.current) clearTimeout(copyAffordanceTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await listAnonymousTokens();
      setTokens(next);
    } catch (error) {
      setLoadError(mapCreateError(error, copy.errors));
    } finally {
      setIsLoading(false);
    }
  }, [copy.errors]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const activeCount = tokens.filter((t) => t.status === "active").length;
  const atCap = activeCount >= ACTIVE_CAP;
  const showCapBanner = atCap || capErrorText !== null;
  const capBannerBody = capErrorText ?? copy.capBannerBody;

  useEffect(() => {
    if (!atCap) setCapErrorText(null);
  }, [atCap]);

  function setTransientTimer(
    ref: { current: ReturnType<typeof setTimeout> | null },
    callback: () => void,
  ) {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => {
      ref.current = null;
      callback();
    }, TRANSIENT_STATE_MS);
  }

  async function handleSubmitCreate(expiresInDays: number) {
    setIsCreating(true);
    setCreateError(null);
    setFlash(null);
    try {
      const created = await createAnonymousToken(expiresInDays);
      setTokens((current) => [created, ...current]);
      setCapErrorText(null);
      setJustCreatedId(created.id);
      setCopyAffordanceId(created.id);
      setTransientTimer(newBadgeTimerRef, () => setJustCreatedId(null));
      setTransientTimer(copyAffordanceTimerRef, () => setCopyAffordanceId(null));
      setCreateDialogOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "anonymous_token_cap_exceeded") {
        setCapErrorText(copy.errors.capExceeded);
        setCreateDialogOpen(false);
        await loadTokens();
      }
      setCreateError(mapCreateError(error, copy.errors));
    } finally {
      setIsCreating(false);
    }
  }

  async function triggerCopyUrl(token: AnonymousShareTokenDto) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(token.url);
      }
      setFlash(null);
      setCopyAffordanceId(null);
      setCopyFeedbackId(token.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedbackId(null), COPY_FEEDBACK_MS);
    } catch {
      setFlash({ tone: "error", text: copy.errors.copyFailed });
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setIsRevoking(true);
    setFlash(null);
    try {
      await revokeAnonymousToken(revokeTarget.id);
      const revokedAt = new Date().toISOString();
      setTokens((current) =>
        current.map((token) =>
          token.id === revokeTarget.id
            ? { ...token, revokedAt, status: "revoked" }
            : token,
        ),
      );
      if (justCreatedId === revokeTarget.id) setJustCreatedId(null);
      if (copyAffordanceId === revokeTarget.id) setCopyAffordanceId(null);
      if (copyFeedbackId === revokeTarget.id) setCopyFeedbackId(null);
      setCapErrorText(null);
      setRevokeTarget(null);
    } catch (error) {
      setFlash({ tone: "error", text: mapRevokeError(error, copy.errors) });
    } finally {
      setIsRevoking(false);
    }
  }

  return (
    <Card className="space-y-5" data-testid="sharing-public-links-section">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{copy.eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{copy.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            {(atCap ? copy.descriptionAtCap : copy.descriptionWithCount)
              .replace("{active}", String(activeCount))
              .replace("{limit}", String(ACTIVE_CAP))}
          </p>
        </div>

        <div>
          <Button
            onClick={() => {
              if (atCap) return;
              setCreateError(null);
              setCreateDialogOpen(true);
            }}
            disabled={atCap || isLoading}
            aria-disabled={atCap || isLoading ? true : undefined}
            data-testid="sharing-public-links-create"
          >
            {copy.createButton}
          </Button>
        </div>
      </div>

      {showCapBanner ? (
        <div
          className="rounded-[20px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800"
          role="status"
          data-testid="sharing-public-links-cap-banner"
        >
          <p className="font-semibold">
            {copy.capBannerTitle} <span className="font-mono text-xs">{activeCount} / {ACTIVE_CAP}</span>
          </p>
          <p className="mt-1">{capBannerBody}</p>
        </div>
      ) : null}

      {flash ? (
        <p
          className={
            flash.tone === "success"
              ? "rounded-[18px] border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700"
              : "rounded-[18px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
          }
          role="status"
          aria-live="polite"
          data-testid="sharing-public-links-flash"
        >
          {flash.text}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-500" data-testid="sharing-public-links-loading">
          {dict.sharing.loading}
        </p>
      ) : loadError ? (
        <p
          className="rounded-[18px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700"
          role="alert"
          data-testid="sharing-public-links-load-error"
        >
          {loadError}
        </p>
      ) : (
        <AnonymousLinksTable
          locale={locale}
          tokens={tokens}
          justCreatedId={justCreatedId}
          copyAffordanceId={copyAffordanceId}
          copyFeedbackId={copyFeedbackId}
          onCopyUrl={(token) => void triggerCopyUrl(token)}
          onRevoke={setRevokeTarget}
        />
      )}

      <p className="text-xs text-slate-500">
        {copy.retentionNote.split("{link}").map((fragment, idx, arr) =>
          idx < arr.length - 1 ? (
            <span key={idx}>
              {fragment}
              <a href="/admin/audit-log" className="text-indigo-600 underline-offset-2 hover:underline">
                {copy.auditLogLink}
              </a>
            </span>
          ) : (
            <span key={idx}>{fragment}</span>
          ),
        )}
      </p>

      <CreateAnonymousLinkDialog
        open={createDialogOpen}
        locale={locale}
        isSubmitting={isCreating}
        error={createError}
        onSubmit={(days) => void handleSubmitCreate(days)}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateError(null);
        }}
      />
      <RevokeAnonymousLinkDialog
        open={revokeTarget !== null}
        locale={locale}
        isSubmitting={isRevoking}
        onConfirm={() => void handleConfirmRevoke()}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      />
    </Card>
  );
}
