"use client";

import type { AppDictionary } from "../../lib/i18n/types";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

interface AppShellBannersProps {
  dict: AppDictionary;
  globalError: string;
  transactionMessage: string;
  recomputeMessage: string;
  snapshotMessage: string;
  mutationsMessage: string;
  mutationsErrorMessage: string;
  onClearGlobalError: () => void;
}

/**
 * Status / error banner stack rendered inside `<main>` above the page
 * content. Extracted from AppShell.tsx per Phase 3c spec target (AppShell
 * ≤300 LOC). Testids preserved verbatim:
 *   `global-error-banner`, `transaction-status`, `mutation-status`,
 *   `recompute-status`, `snapshot-status`.
 */
export function AppShellBanners({
  dict,
  globalError,
  transactionMessage,
  recomputeMessage,
  snapshotMessage,
  mutationsMessage,
  mutationsErrorMessage,
  onClearGlobalError,
}: AppShellBannersProps) {
  return (
    <>
      {globalError ? (
        <div
          className="mb-5 rounded-[22px] border border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] px-4 py-3 text-sm text-rose-700 shadow-[0_18px_36px_rgba(251,113,133,0.12)]"
          role="status"
          aria-live="polite"
          data-testid="global-error-banner"
        >
          <p>
            {dict.feedback.requestFailedPrefix}: {globalError}
          </p>
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={onClearGlobalError}>
              {dict.actions.retry}
            </Button>
          </div>
        </div>
      ) : null}

      {!globalError && transactionMessage ? (
        <p
          className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
          data-testid="transaction-status"
          role="status"
          aria-live="polite"
        >
          {transactionMessage}
        </p>
      ) : null}

      {!globalError && (mutationsMessage || mutationsErrorMessage) ? (
        <p
          className={cn(
            "mb-5 rounded-[22px] border px-4 py-3 text-sm",
            mutationsErrorMessage
              ? "border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] text-rose-700"
              : "border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] text-emerald-700",
          )}
          data-testid="mutation-status"
          role="status"
          aria-live="polite"
        >
          {mutationsErrorMessage || mutationsMessage}
        </p>
      ) : null}

      {!globalError && !transactionMessage && recomputeMessage ? (
        <p
          className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
          data-testid="recompute-status"
          role="status"
          aria-live="polite"
        >
          {recomputeMessage}
        </p>
      ) : null}

      {!globalError && snapshotMessage ? (
        <p
          className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
          data-testid="snapshot-status"
          role="status"
          aria-live="polite"
        >
          {snapshotMessage}
        </p>
      ) : null}
    </>
  );
}
