"use client";

import { cn } from "../../lib/utils";

export function holdingsFinanceToneClass(
  value: number | null | undefined,
  neutralClass = "text-foreground",
): string {
  if (value === null || value === undefined || value === 0) return neutralClass;
  if (value > 0) return financeGainTextClass;
  return financeLossTextClass;
}

export const financeGainTextClass = "text-[hsl(var(--finance-gain))]";
export const financeLossTextClass = "text-[hsl(var(--finance-loss))]";
export const financeGainDotClass = "bg-[hsl(var(--finance-gain))]";
export const financeLossDotClass = "bg-[hsl(var(--finance-loss))]";
export const financeGainSurfaceClass = "border-[hsl(var(--finance-gain)/0.4)] bg-[hsl(var(--finance-gain)/0.1)] text-[hsl(var(--finance-gain))]";
export const financeLossSurfaceClass = "border-[hsl(var(--finance-loss)/0.4)] bg-[hsl(var(--finance-loss)/0.1)] text-[hsl(var(--finance-loss))]";

export function holdingsFinanceSurfaceClass(
  value: number | null | undefined,
  neutralClass = "border-border bg-muted/30 text-muted-foreground",
): string {
  if (value === null || value === undefined || value === 0) return neutralClass;
  return value > 0 ? financeGainSurfaceClass : financeLossSurfaceClass;
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

export const holdingsWarningBadgeClassName = "border-warning/60 bg-warning/10 text-warning";
export const holdingsInfoBadgeClassName = "border-primary/40 bg-primary/10 text-primary";
