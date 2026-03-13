import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "glass-panel min-w-0 rounded-[28px] px-5 py-5 shadow-[0_24px_56px_rgba(148,163,184,0.14)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300/90 sm:px-6 sm:py-6",
        className,
      )}
      {...props}
    />
  );
}
