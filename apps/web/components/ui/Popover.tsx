"use client";

// Phase 1 adapter shim: re-exports the shadcn Popover under the
// `PopoverRoot/PopoverTrigger/PopoverContent` names the project consumers
// already use. shadcn's Popover wraps Radix and handles Portal + Content
// internally, so we don't need to compose them here.
//
// admin-ui-bugs: callers stamp their own data-testid on PopoverTrigger
// (via asChild → button) and on PopoverContent — both pass through.

export { Popover as PopoverRoot, PopoverTrigger, PopoverContent } from "./shadcn/popover";
