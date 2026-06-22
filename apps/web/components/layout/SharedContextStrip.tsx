"use client";

import { cn } from "../../lib/utils";

interface SharedContextStripProps {
  ownerLabel: string;
  titleTemplate: string;
  subtitleTemplate: string;
  actionLabel: string;
  onExitSharedContext: () => void;
}

export function SharedContextStrip({
  ownerLabel,
  titleTemplate,
  subtitleTemplate,
  actionLabel,
  onExitSharedContext,
}: SharedContextStripProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 mb-5 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-[0_10px_22px_rgba(15,23,42,0.06)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150",
        "sm:flex-row sm:items-center sm:justify-between sm:gap-4",
      )}
      data-testid="shared-context-strip"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">
            {titleTemplate.replaceAll("{owner}", ownerLabel)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {subtitleTemplate.replaceAll("{owner}", ownerLabel)}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        onClick={onExitSharedContext}
        data-testid="shared-context-strip-exit"
      >
        {actionLabel}
      </button>
    </div>
  );
}
