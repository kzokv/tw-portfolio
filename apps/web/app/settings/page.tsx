import { redirect } from "next/navigation";

/**
 * Phase 3d S2 — `/settings` lands on `/settings/profile` by default.
 *
 * Server redirect (not client `router.replace`) so unauthenticated visitors
 * still get the `/login` flow via the parent layout's `requireSession()`
 * BEFORE the bounce; bots don't render this as a content page.
 */
export default function SettingsIndexPage(): never {
  redirect("/settings/profile");
}
