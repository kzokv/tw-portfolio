import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(79,70,229,0.48)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transform-none",
  {
    variants: {
      variant: {
        default:
          "border-[rgba(79,70,229,0.22)] bg-[linear-gradient(135deg,#6366f1,#4f46e5)] text-white shadow-[0_18px_36px_rgba(79,70,229,0.24)] hover:border-[rgba(79,70,229,0.34)] hover:brightness-[1.04]",
        secondary:
          "border-slate-200 bg-white/88 text-slate-700 shadow-[0_10px_22px_rgba(148,163,184,0.12)] hover:border-slate-300 hover:bg-white",
        ghost: "border-transparent bg-transparent text-slate-600 hover:bg-white/75 hover:text-slate-900",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { Button, buttonVariants };
