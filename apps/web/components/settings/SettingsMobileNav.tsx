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

interface MobileNavLabels {
  profile: string;
  accounts: string;
  display: string;
  tickers: string;
}

interface SettingsMobileNavProps {
  labels: MobileNavLabels;
}

const SLUGS: SettingsNavSlug[] = ["profile", "accounts", "display", "tickers"];

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
export function SettingsMobileNav({ labels }: SettingsMobileNavProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/settings/profile";
  const current: SettingsNavSlug = SLUGS.find((slug) =>
    pathname === `/settings/${slug}` || pathname.startsWith(`/settings/${slug}/`),
  ) ?? "profile";

  return (
    <Select
      value={current}
      onValueChange={(next) => {
        router.push(`/settings/${next}`);
      }}
    >
      <SelectTrigger data-testid="settings-nav-mobile" className="w-full">
        <SelectValue placeholder={labels[current]} />
      </SelectTrigger>
      <SelectContent>
        {SLUGS.map((slug) => (
          <SelectItem key={slug} value={slug}>
            {labels[slug]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
