"use client";

import { useEffect, useMemo, useState } from "react";
import type { NotificationDto } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { patchJson } from "../../lib/api";
import { Button } from "../ui/Button";

interface EscalationTooltipProps {
  notifications: NotificationDto[];
  onDismissed: () => void;
  dict: AppDictionary;
}

const ERROR_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function EscalationTooltip({ notifications, onDismissed, dict }: EscalationTooltipProps) {
  const [dismissed, setDismissed] = useState(false);

  const candidate = useMemo(() => {
    const now = Date.now();
    const candidates = notifications
      .filter((n) => {
        if (n.readAt || n.escalatedAt || n.dismissedAt) return false;
        if (n.severity !== "error" && n.severity !== "warning") return false;
        const age = now - new Date(n.createdAt).getTime();
        if (n.severity === "error" && age < ERROR_THRESHOLD_MS) return false;
        if (n.severity === "warning" && age < WARNING_THRESHOLD_MS) return false;
        return true;
      })
      .sort((a, b) => {
        // Errors first, then by age (oldest first)
        if (a.severity === "error" && b.severity !== "error") return -1;
        if (a.severity !== "error" && b.severity === "error") return 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    return candidates[0] ?? null;
  }, [notifications]);

  // Reset dismissed state when candidate changes
  useEffect(() => {
    setDismissed(false);
  }, [candidate?.id]);

  if (!candidate || dismissed) return null;

  async function handleDismiss() {
    if (!candidate) return;
    setDismissed(true);
    try {
      await patchJson(`/notifications/${candidate.id}/escalate`, {});
    } catch {
      // Best effort — tooltip is already hidden
    }
    onDismissed();
  }

  return (
    <div
      className="absolute right-0 top-[calc(100%+0.5rem)] z-[90] w-72 rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-[0_12px_28px_rgba(245,158,11,0.18)]"
      data-testid="escalation-tooltip"
    >
      <p className="text-xs leading-5 text-amber-800">{dict.notifications.escalationTooltip}</p>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2 text-[11px] text-amber-700 hover:bg-amber-100"
          onClick={() => void handleDismiss()}
          data-testid="escalation-dismiss"
        >
          {dict.notifications.dismissEscalation}
        </Button>
      </div>
    </div>
  );
}
