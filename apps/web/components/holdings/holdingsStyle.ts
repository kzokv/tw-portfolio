"use client";

import { cn } from "../../lib/utils";

export function holdingsFinanceToneClass(
  value: number | null | undefined,
  neutralClass = "text-foreground",
): string {
  if (value === null || value === undefined || value === 0) return neutralClass;
  if (value > 0) return "text-[hsl(var(--success))]";
  return "text-[hsl(var(--destructive))]";
}

export function holdingsStickyFirstColumnClassName(
  enabled: boolean,
  layer: "cell" | "header" = "cell",
  backgroundClassName = "bg-card",
): string {
  if (!enabled) return "";
  return cn(
    "sticky left-0",
    layer === "header" ? "z-30" : "z-10",
    backgroundClassName,
  );
}

export function holdingsFreshnessDotClassName(freshness: "current" | "stale_amber" | "stale_red"): string {
  return freshness === "stale_red" ? "bg-destructive" : "bg-warning";
}

export const holdingsWarningBadgeClassName = "border-warning/60 bg-warning/10 text-warning";
export const holdingsInfoBadgeClassName = "border-primary/40 bg-primary/10 text-primary";
