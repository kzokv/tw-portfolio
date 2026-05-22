"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CreditCard, ListChecks, Palette, Settings as SettingsIcon, UserCircle2 } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Phase 3d S2 — desktop inner sidebar for the `/settings/*` two-pane shell.
 *
 * Five entries: Profile, General, Accounts, Display, Tickers. (`General`
 * restored 2026-05-17 — see GeneralSettingsClient.tsx header. Notifications
 * + Privacy still dropped from v1 per §12 A5.)
 *
 * Locked testid contract (architect-design.md §6.1):
 *   - `settings-nav` on the <aside> root
 *   - `settings-nav-item-{slug}` on each <a>
 */

export type SettingsNavSlug = "profile" | "general" | "accounts" | "ai-connectors" | "display" | "tickers";

interface NavCopyLabels {
  profile: string;
  general: string;
  accounts: string;
  "ai-connectors": string;
  display: string;
  tickers: string;
}

interface SettingsNavProps {
  labels: NavCopyLabels;
}

const ITEMS: Array<{ slug: SettingsNavSlug; icon: typeof UserCircle2 }> = [
  { slug: "profile", icon: UserCircle2 },
  { slug: "general", icon: SettingsIcon },
  { slug: "accounts", icon: CreditCard },
  { slug: "ai-connectors", icon: Bot },
  { slug: "display", icon: Palette },
  { slug: "tickers", icon: ListChecks },
];

export function SettingsNav({ labels }: SettingsNavProps) {
  const pathname = usePathname() ?? "/settings/profile";
  return (
    <aside
      data-testid="settings-nav"
      className="w-56 shrink-0 border-r border-border bg-card/40 p-3"
    >
      <nav className="flex flex-col gap-1">
        {ITEMS.map(({ slug, icon: Icon }) => {
          const href = `/settings/${slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={slug}
              href={href}
              data-testid={`settings-nav-item-${slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{labels[slug]}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
