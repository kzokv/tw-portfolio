"use client";

// admin-ui-bugs: Radix Popover shim. Sibling pattern to `TooltipInfo` —
// project-styled re-exports of the Radix primitives. Callers stamp their
// own `data-testid` on `PopoverTrigger` (typically via `asChild` so the
// testid lands on the underlying button) and on `PopoverContent`.
//
// `forceMount` is intentionally NOT applied — popovers mount on open and
// unmount on close, which is the desired behavior for click-popovers
// over provider name cells in `/admin/providers`.

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";

export const PopoverRoot = Popover.Root;

export const PopoverTrigger = Popover.Trigger;

interface PopoverContentProps
  extends React.ComponentPropsWithoutRef<typeof Popover.Content> {
  /** Optional data-testid stamped on the rendered popover panel. */
  "data-testid"?: string;
}

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof Popover.Content>,
  PopoverContentProps
>(function PopoverContent(
  { className, sideOffset = 6, side = "top", children, ...props },
  ref,
) {
  return (
    <Popover.Portal>
      <Popover.Content
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        className={
          className ??
          "glass-panel z-[60] max-w-xs break-words rounded-2xl px-3 py-2 text-xs leading-5 text-slate-900 shadow-glass"
        }
        {...props}
      >
        {children}
        <Popover.Arrow className="fill-slate-900/90" />
      </Popover.Content>
    </Popover.Portal>
  );
});
