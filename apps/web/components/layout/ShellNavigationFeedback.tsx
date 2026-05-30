"use client";

import { Loader2 } from "lucide-react";
import { useNavigationFeedback } from "./NavigationFeedbackContext";

export function ShellNavigationFeedback() {
  const { isPending, pendingLabel } = useNavigationFeedback();

  if (!isPending || !pendingLabel) return null;

  return (
    <div
      className="sticky top-0 z-20 -mt-2 mb-4 flex justify-center px-1"
      aria-live="polite"
      data-testid="shell-navigation-feedback"
    >
      <div className="flex w-full max-w-2xl items-center gap-2 rounded-full border border-border/80 bg-background/95 px-4 py-2 text-sm text-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground" data-testid="shell-navigation-feedback-label">
          Opening {pendingLabel}
        </span>
        <span className="ml-auto text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Navigating
        </span>
      </div>
    </div>
  );
}
