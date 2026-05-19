// Phase 1 adapter shim: preserves the existing single-element `Card` API
// (renders <section>) and exposes shadcn sub-components for new call sites.

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export {
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "./shadcn/card";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card px-5 py-5 text-card-foreground shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-foreground/20 sm:px-6 sm:py-6",
        className,
      )}
      {...props}
    />
  );
}
