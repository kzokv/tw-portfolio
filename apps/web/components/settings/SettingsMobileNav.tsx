"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import type { SettingsNavSlug } from "./SettingsNav";

interface SettingsMobileNavProps {
  items: Array<{ slug: SettingsNavSlug; label: string }>;
}

/**
 * Phase 3d S2 — mobile-viewport section switcher for the `/settings/*` shell.
 *
 * Visible only on `<md`. Renders a shadcn `<Select>` (testid
 * `settings-nav-mobile` per architect-design.md §6.1) whose change handler
 * navigates to `/settings/{section}` via `router.push`.
 *
 * Per `.claude/rules/playwright-navigation-patterns.md`, `router.push` is
 * fine here because the assertion target is "URL eventually contains
 * /settings/X" rather than "URL synchronously equals X" — no E2E spec races
 * the router commit on a full-page navigation.
 */
export function SettingsMobileNav({ items }: SettingsMobileNavProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/settings/profile";
  const current = items.find(({ slug }) =>
    pathname === `/settings/${slug}` || pathname.startsWith(`/settings/${slug}/`),
  )?.slug ?? items[0]?.slug ?? "profile";
  const currentLabel = items.find((item) => item.slug === current)?.label ?? items[0]?.label ?? "";

  return (
    <Select
      value={current}
      onValueChange={(next) => {
        router.push(`/settings/${next}`);
      }}
    >
      <SelectTrigger data-testid="settings-nav-mobile" className="w-full">
        <SelectValue placeholder={currentLabel} />
      </SelectTrigger>
      <SelectContent>
        {items.map(({ slug, label }) => (
          <SelectItem key={slug} value={slug}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
