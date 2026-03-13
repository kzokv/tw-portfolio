"use client";

/**
 * Unified loading state for the dashboard: skeleton layout + in-content progress bar.
 * Used for initial load (Suspense fallback), bootstrap, and refresh.
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
      <div className="grid gap-6 xl:grid-cols-12" aria-hidden="true">
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-1" className="xl:col-span-12">
          <div className="skeleton-line h-3 w-28 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-3 h-10 w-80 rounded-2xl" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full max-w-2xl rounded" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="skeleton-line h-24 rounded-[22px]" />
            <div className="skeleton-line h-24 rounded-[22px]" />
            <div className="skeleton-line h-24 rounded-[22px]" />
          </div>
        </SkeletonCard>
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-2" className="xl:col-span-8">
          <div className="skeleton-line h-6 w-32 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full rounded" />
          <div className="skeleton-line skeleton-line--delay mt-1 h-4 max-w-[66%] rounded" />
          <div className="mt-5 grid gap-3">
            <div className="skeleton-line h-28 rounded-[22px]" />
            <div className="skeleton-line h-28 rounded-[22px]" />
          </div>
        </SkeletonCard>
        <SkeletonCard delayClass="dashboard-skeleton-card--delay-3" className="xl:col-span-4">
          <div className="skeleton-line h-6 w-28 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full rounded" />
          <div className="mt-5 grid gap-3">
            <div className="skeleton-line h-24 rounded-[22px]" />
            <div className="skeleton-line h-24 rounded-[22px]" />
          </div>
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
        {content}
      </main>
    );
  }

  return <div role="status" aria-busy="true">{content}</div>;
}
