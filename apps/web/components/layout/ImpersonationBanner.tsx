"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { deleteJson } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { ProfileImpersonationDto } from "../../features/profile/hooks/useProfile";
import { Button } from "../ui/Button";

interface ImpersonationBannerProps {
  impersonation: ProfileImpersonationDto | null | undefined;
  onRefreshContext: () => Promise<unknown>;
}

const EXPIRED_REFRESH_RETRY_MS = 3000;

function getRemainingMs(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ImpersonationBanner({ impersonation, onRefreshContext }: ImpersonationBannerProps) {
  const router = useRouter();
  const [isExiting, setIsExiting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() =>
    impersonation ? getRemainingMs(impersonation.expiresAt) : 0,
  );
  const zeroRefreshTriggeredRef = useRef(false);

  useEffect(() => {
    zeroRefreshTriggeredRef.current = false;
    setRemainingMs(impersonation ? getRemainingMs(impersonation.expiresAt) : 0);
  }, [impersonation]);

  useEffect(() => {
    if (!impersonation) return;

    const tick = () => {
      const nextRemainingMs = getRemainingMs(impersonation.expiresAt);
      setRemainingMs(nextRemainingMs);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [impersonation]);

  useEffect(() => {
    if (!impersonation) return;
    if (remainingMs > 0) return;

    let cancelled = false;

    const runRefresh = async () => {
      if (cancelled) return;
      if (!zeroRefreshTriggeredRef.current) {
        zeroRefreshTriggeredRef.current = true;
      }
      try {
        await onRefreshContext();
      } catch {
        // retry loop below keeps polling until impersonation clears
      }
    };

    void runRefresh();
    const retryIntervalId = window.setInterval(() => {
      void runRefresh();
    }, EXPIRED_REFRESH_RETRY_MS);

    return () => {
      cancelled = true;
      window.clearInterval(retryIntervalId);
    };
  }, [impersonation, onRefreshContext, remainingMs]);

  const resolvedImpersonation = useMemo(() => {
    if (!impersonation) return null;
    if (impersonation.active === false) return null;
    return impersonation;
  }, [impersonation]);

  if (!resolvedImpersonation) return null;

  const targetLabel = resolvedImpersonation.targetEmail ?? resolvedImpersonation.targetUserId;

  async function handleExit(): Promise<void> {
    setIsExiting(true);
    try {
      await deleteJson<void>("/admin/impersonation");
      await onRefreshContext();
      router.push("/admin/users");
      router.refresh();
    } finally {
      setIsExiting(false);
    }
  }

  return (
    <div
      className="border-b border-red-950/30 bg-[linear-gradient(90deg,#7f1d1d,#991b1b)] text-white shadow-[0_16px_36px_rgba(127,29,29,0.28)]"
      data-testid="impersonation-banner"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 md:px-8 xl:px-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-200/60 bg-red-200/85 text-red-900">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="truncate text-sm font-medium text-red-50">
              <span className="font-semibold">Impersonating</span>
              <span className="mx-2 font-bold text-white">{targetLabel}</span>
              <span className="text-red-100">writes are disabled</span>
              <span className="mx-2 text-red-200">·</span>
              <span className="text-red-100">auto-exit in</span>
              <span className="ml-2 font-mono font-bold tracking-[0.2em] text-red-100" data-testid="impersonation-countdown">
                {formatCountdown(remainingMs)}
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className={cn(
            "shrink-0 border-red-200/25 bg-white/10 text-white shadow-none hover:border-red-200/35 hover:bg-white/16",
            isExiting && "cursor-wait",
          )}
          disabled={isExiting}
          onClick={() => void handleExit()}
          data-testid="exit-impersonation-button"
        >
          {isExiting ? "Exiting..." : "Exit Impersonation"}
        </Button>
      </div>
    </div>
  );
}
