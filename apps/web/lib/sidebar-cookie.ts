// Server-only read helper for the shadcn sidebar `sidebar_state` cookie.
// Pre-resolves the sidebar open/closed state in a server component so the
// first paint matches the user's last toggle (no FOUC).
//
// Per `.claude/rules/nextjs-server-cookie-access.md`, `next/headers` `cookies()`
// only works in server components / route handlers. Do NOT import this from
// any "use client" module.

import { cookies } from "next/headers";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Read the shadcn sidebar collapsed state from the `sidebar_state` cookie.
 * shadcn writes `"true"` / `"false"`. We default to `true` (expanded) to match
 * shadcn's `SidebarProvider` default behavior — see
 * `apps/web/components/ui/shadcn/sidebar.tsx:28` for the cookie name constant.
 */
export async function readSidebarStateCookie(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(SIDEBAR_COOKIE_NAME)?.value;
  if (value === "false") return false;
  return true;
}
