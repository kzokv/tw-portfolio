import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function HoldingsGridEmptyState({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("rounded-md border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function HoldingsGridMobileList({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 lg:hidden", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export function HoldingsGridDesktopFrame({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("hidden overflow-auto rounded-md border border-border lg:block", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export function HoldingsGridNativeTable({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <table
      className={cn("w-full table-fixed border-collapse text-sm text-muted-foreground [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal [&_th]:break-words", className)}
      data-testid={testId}
    >
      {children}
    </table>
  );
}
