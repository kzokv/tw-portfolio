"use client";

/**
 * Skeleton for the page hero/banner. One big line (title), two smaller lines (subtitle).
 * Preserves layout to avoid shift when real content loads.
 */
export function HeroSkeleton() {
  return (
    <div
      className="glass-panel mb-6 rounded-[28px] px-5 py-5 shadow-glass sm:px-6 sm:py-6"
      aria-hidden="true"
      data-testid="hero-skeleton"
    >
      <div className="skeleton-line h-3 w-24 rounded" />
      <div className="skeleton-line skeleton-line--delay mt-3 h-10 w-56 rounded-2xl" />
      <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-full max-w-md rounded" />
      <div className="skeleton-line skeleton-line--delay mt-2 h-4 w-3/4 max-w-sm rounded" />
    </div>
  );
}
