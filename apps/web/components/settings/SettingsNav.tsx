"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, ListChecks, Palette, UserCircle2 } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Phase 3d S2 — desktop inner sidebar for the `/settings/*` two-pane shell.
 *
 * Renders exactly four entries per A5 (Notifications + Privacy dropped from
 * v1). Each item is a real `<a>` link (full-page navigations are cheap in the
 * Next.js App Router because the layout is shared). Active state is driven
 * off `usePathname()` so deep links highlight correctly.
 *
 * Locked testid contract (architect-design.md §6.1):
 *   - `settings-nav` on the <aside> root
 *   - `settings-nav-item-{slug}` on each <a>
 */

export type SettingsNavSlug = "profile" | "accounts" | "display" | "tickers";

interface NavCopyLabels {
  profile: string;
  accounts: string;
  display: string;
  tickers: string;
}

interface SettingsNavProps {
  labels: NavCopyLabels;
}

const ITEMS: Array<{ slug: SettingsNavSlug; icon: typeof UserCircle2 }> = [
  { slug: "profile", icon: UserCircle2 },
  { slug: "accounts", icon: CreditCard },
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
