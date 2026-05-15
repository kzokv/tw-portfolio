// Phase 1 adapter shim: preserves the existing project Button API
// (`Button` default-export-as-named + `buttonVariants`) while delegating
// rendering to the shadcn primitive at ./shadcn/button. Adds `type="button"`
// default that the project relies on.
//
// The full shadcn variant + size matrix is available — old call sites that
// passed variant="default"|"secondary"|"ghost" + size="default"|"sm" keep
// working unchanged; new sites can use destructive/outline/link + xs/lg/icon.
//
// Deleted in Phase 7 once every consumer imports from "@/components/ui/shadcn/button".

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Button as ShadcnButton, buttonVariants, type ButtonProps as ShadcnButtonProps } from "./shadcn/button";

export type ButtonProps = ShadcnButtonProps;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ButtonProps,
  ref,
) {
  return <ShadcnButton ref={ref} type={type} {...props} />;
});

export { Button, buttonVariants };
