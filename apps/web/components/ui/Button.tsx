import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(109,94,252,0.7)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transform-none",
  {
    variants: {
      variant: {
        default:
          "border-[rgba(109,94,252,0.45)] bg-[rgba(109,94,252,0.92)] text-white shadow-[0_14px_30px_rgba(109,94,252,0.3)] hover:border-[rgba(143,133,255,0.8)] hover:bg-[rgba(143,133,255,0.92)]",
        secondary:
          "border-white/10 bg-white/5 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/10",
        ghost: "border-transparent bg-transparent text-slate-200 hover:bg-white/8 hover:text-white",
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
