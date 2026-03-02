import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "glass-panel min-w-0 rounded-[24px] px-5 py-5 shadow-glass transition duration-200 hover:-translate-y-0.5 hover:border-white/15 sm:px-6 sm:py-6",
        className,
      )}
      {...props}
    />
  );
}
