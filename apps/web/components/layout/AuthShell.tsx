// Phase 5b — shared shell for /login, /auth/error, /invite/[code].
// Children-only API per scope-grill lock #8. Optional `cardClassName`
// escape hatch because the 3 candidate pages don't share Card width
// (/login + /auth/error use max-w-sm; /invite uses max-w-lg) — a single
// fixed max-w would force one of them out of design alignment.

import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";

export interface AuthShellProps {
  children: ReactNode;
  /** Override the Card's width clamp. Default `max-w-sm`. */
  cardClassName?: string;
}

export function AuthShell({ children, cardClassName }: AuthShellProps) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4"
      data-testid="auth-shell"
    >
      <Card className={cn("w-full max-w-sm", cardClassName)}>{children}</Card>
    </main>
  );
}
