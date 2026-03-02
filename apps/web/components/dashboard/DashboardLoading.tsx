"use client";

import { HeroSkeleton } from "./HeroSkeleton";

/**
 * Unified loading state for the dashboard: skeleton layout + in-content progress bar.
 * Used for initial load (Suspense fallback), bootstrap, and refresh.
 * - One big line (title), two smaller lines (subtitle), pill/button skeletons per card
 * - Table block: one big line + two smaller lines (card-style)
 * - Respects prefers-reduced-motion with subtle motion
 * - Screen reader: "Loading dashboard"
 */
function SkeletonCard({
  delayClass = "",
  className = "",
  children,
}: { delayClass?: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`dashboard-skeleton-card glass-panel rounded-[24px] p-5 ${delayClass} ${className}`}
    >
      {children}
    </div>
  );
}

export function DashboardLoading({ standalone = false }: { standalone?: boolean }) {
  const content = (
    <>
      <div
        className="dashboard-loading-bar"
        role="progressbar"
        aria-valuetext="indeterminate"
        aria-label="Loading dashboard"
      />
      <div className="grid gap-6 md:grid-cols-2" aria-hidden="true">
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-1">
          <div className="skeleton-line h-6 w-40 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full rounded" />
          <div className="skeleton-line skeleton-line--delay mt-1 h-4 max-w-[80%] rounded" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton-line h-11 w-28 rounded-xl" />
          </div>
        </SkeletonCard>
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-2">
          <div className="skeleton-line h-6 w-36 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full rounded" />
          <div className="skeleton-line skeleton-line--delay mt-1 h-4 max-w-[75%] rounded" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton-line h-11 w-24 rounded-xl" />
            <div className="skeleton-line h-11 w-24 rounded-xl" />
          </div>
        </SkeletonCard>
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-2" className="md:col-span-2">
          <div className="skeleton-line h-6 w-32 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full rounded" />
          <div className="skeleton-line skeleton-line--delay mt-1 h-4 max-w-[66%] rounded" />
        </SkeletonCard>
      </div>
    </>
  );

  if (standalone) {
    return (
      <main
        className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8"
        data-testid="app-loading"
        role="status"
        aria-busy="true"
      >
        <HeroSkeleton />
        {content}
      </main>
    );
  }

  return <div role="status" aria-busy="true">{content}</div>;
}
