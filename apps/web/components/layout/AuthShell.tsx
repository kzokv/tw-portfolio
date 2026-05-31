// Phase 5b — shared shell for /login, /auth/error, /invite/[code].
// Children-only API per scope-grill lock #8. Optional `cardClassName`
// escape hatch because the 3 candidate pages don't share Card width
// (/login + /auth/error use max-w-sm; /invite uses max-w-lg) — a single
// fixed max-w would force one of them out of design alignment.

import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export interface AuthShellProps {
  children: ReactNode;
  /** Override the Card's width clamp. Default `max-w-sm`. */
  cardClassName?: string;
}

export function AuthShell({ children, cardClassName }: AuthShellProps) {
  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6"
      data-testid="auth-shell"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.08),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background))_62%,hsla(var(--muted),0.55))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,hsla(var(--primary),0.06),transparent)]" />

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle iconOnly={false} />
      </div>

      <Card
        className={cn(
          "relative w-full max-w-sm rounded-[2rem] border-border/70 bg-card/95 px-5 py-6 shadow-[0_28px_90px_rgba(15,23,42,0.08)] backdrop-blur sm:px-7 sm:py-7",
          cardClassName,
        )}
      >
        {children}
      </Card>
    </main>
  );
}
