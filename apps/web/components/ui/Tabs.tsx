"use client";

// KZO-199 — Radix Tabs primitive shim. Mirrors the project convention
// (cf. TooltipInfo.tsx) — re-export Radix primitives with project-styled
// defaults so callers don't import @radix-ui directly. Locked testid
// strings (architect-design.md §0) are passed by callers; this shim does
// not stamp testids itself.

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

export const TabsRoot = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className = "", ...props }, ref) {
  // KZO-199 iter 3 — `overflow-x-auto flex-nowrap` keeps all 5 tab triggers
  // reachable on <640px viewports. `snap-x snap-mandatory` + `snap-start`
  // (on triggers) make horizontal scroll feel like a tab strip on mobile.
  // `max-w-full` ensures the list shrinks to the available width before
  // engaging the scroll. At lg+, the natural inline-flex width fits without
  // scrolling — the overflow wrapper is a no-op.
  return (
    <TabsPrimitive.List
      ref={ref}
      className={`inline-flex h-10 max-w-full snap-x snap-mandatory flex-nowrap items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1 ${className}`}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className = "", ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={`inline-flex shrink-0 snap-start items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm ${className}`}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className = "", ...props }, ref) {
  // `forceMount` keeps every panel in the DOM regardless of which tab is
  // active. Radix stamps `hidden` + `data-state="inactive"` on inactive
  // panels, which:
  //   - Playwright `waitFor({state: "visible"})` correctly reports as
  //     hidden (the locked tab-nav E2E spec relies on this)
  //   - @testing-library `getByTestId` still finds (the AdminSettingsClient
  //     metadata-mode unit tests rely on this — section is in the
  //     catalog-metadata tab; without forceMount it's unmounted on the
  //     default rate-limits view).
  return (
    <TabsPrimitive.Content
      ref={ref}
      forceMount
      className={`mt-4 focus-visible:outline-none data-[state=inactive]:hidden ${className}`}
      {...props}
    />
  );
});
