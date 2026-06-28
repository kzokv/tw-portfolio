"use client";

import type { ReactNode } from "react";
import type {
  AiConnectorPolicySettingsDto,
  AiConnectorReadinessCheckStatus,
} from "@vakwen/shared-types";
import { cn } from "../../lib/utils";

export type McpStatusTone = "emerald" | "amber" | "rose" | "sky" | "slate";

export function mcpStatusTone(
  status: AiConnectorReadinessCheckStatus | AiConnectorPolicySettingsDto["readiness"]["status"] | undefined,
): Exclude<McpStatusTone, "sky"> {
  if (status === "ready" || status === "ok") return "emerald";
  if (status === "degraded" || status === "warning") return "amber";
  if (status === "disabled" || status === "blocked") return "rose";
  return "slate";
}

export function mcpStatusChipClass(tone: McpStatusTone): string {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
    tone === "emerald" && "border-emerald-200 bg-emerald-50 text-emerald-700",
    tone === "amber" && "border-amber-200 bg-amber-50 text-amber-800",
    tone === "rose" && "border-rose-200 bg-rose-50 text-rose-700",
    tone === "sky" && "border-sky-200 bg-sky-50 text-sky-700",
    tone === "slate" && "border-slate-200 bg-slate-100 text-slate-700",
  );
}

export function McpStatusChip({ children, tone }: { children: ReactNode; tone: McpStatusTone }) {
  return <span className={mcpStatusChipClass(tone)}>{children}</span>;
}
