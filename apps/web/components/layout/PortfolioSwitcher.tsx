"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Users } from "lucide-react";
import type { InboundShareCardItem } from "../../features/sharing/types";
import type { AppDictionary } from "../../lib/i18n/types";
import { cn } from "../../lib/utils";

interface PortfolioSwitcherProps {
  inboundActive: InboundShareCardItem[];
  /** Owner userId of the currently-viewed shared portfolio, or null when the user is in their own context. */
  currentContextOwnerId: string | null;
  /** Called with `null` to switch back to self, or an ownerUserId for an inbound grant. */
  onSelect: (ownerUserId: string | null) => void;
  dict: AppDictionary["switcher"];
  manageSharingHref?: string;
  /** Force-open the dropdown; primarily used by tests. */
  defaultOpen?: boolean;
}

/**
 * PortfolioSwitcher — TopBar dropdown that lets a grantee flip between their
 * own portfolio and any portfolios shared with them read-only (KZO-146 slice 10).
 *
 * Hidden when `inboundActive.length === 0` — only visible once the viewer has
 * inbound shares. In a shared context the trigger shows a rose-tinted pill,
 * a "Read-only" badge, and an eyebrow line indicating the owner's display name.
 */
export function PortfolioSwitcher({
  inboundActive,
  currentContextOwnerId,
  onSelect,
  dict,
  manageSharingHref = "/sharing",
  defaultOpen,
}: PortfolioSwitcherProps) {
  if (inboundActive.length === 0) return null;

  // Active shares from the API always carry a non-null ownerUserId (see
  // ShareGrantRecord). The DTO type (InboundShareCardItem.ownerUserId) is
  // historically nullable to share a shape with legacy rows; enforce the
  // runtime invariant here so callers can treat onSelect's argument as
  // a real ownerUserId (never null-from-inbound-data).
  const sorted = [...inboundActive]
    .filter((item): item is typeof item & { ownerUserId: string } => Boolean(item.ownerUserId))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  if (sorted.length === 0) return null;
  const currentShare = currentContextOwnerId
    ? sorted.find((item) => item.ownerUserId === currentContextOwnerId) ?? null
    : null;
  const isSharedContext = currentShare !== null;

  const triggerLabel = isSharedContext
    ? dict.ownerOptionLabel.replace(
      "{owner}",
      currentShare?.ownerDisplayName || currentShare?.ownerEmail || "",
    )
    : dict.self;

  return (
    <div className="flex min-w-0 flex-col" data-testid="portfolio-switcher-wrapper">
      {isSharedContext ? (
        <p
          className="text-[11px] font-medium uppercase tracking-[0.22em] text-rose-600"
          data-testid="portfolio-switcher-eyebrow"
        >
          {dict.eyebrow}
        </p>
      ) : null}
      <DropdownMenu.Root defaultOpen={defaultOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={dict.triggerLabel}
            data-testid="portfolio-switcher"
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm transition",
              isSharedContext
                ? "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                : "border-slate-200 bg-white/88 text-slate-700 hover:bg-white",
            )}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-[12rem] truncate">{triggerLabel}</span>
            {isSharedContext ? (
              <span
                className="ml-1 rounded-full border border-rose-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600"
                data-testid="portfolio-switcher-badge-readonly"
              >
                {dict.readonlyBadge}
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className="z-50 min-w-[16rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
            data-testid="portfolio-switcher-dropdown"
          >
            <DropdownMenu.Item
              onSelect={() => onSelect(null)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition",
                !isSharedContext
                  ? "bg-slate-100 font-semibold text-slate-950"
                  : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100",
              )}
              data-testid="portfolio-switcher-option-self"
            >
              <span>{dict.self}</span>
            </DropdownMenu.Item>

            {sorted.length > 0 ? (
              <DropdownMenu.Separator className="my-1 h-px bg-slate-200" />
            ) : null}

            {sorted.map((item) => {
              const selected = currentContextOwnerId === item.ownerUserId;
              const ownerName = item.ownerDisplayName || item.ownerEmail;
              return (
                <DropdownMenu.Item
                  key={item.id}
                  onSelect={() => onSelect(item.ownerUserId)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition",
                    selected
                      ? "bg-rose-50 font-semibold text-rose-800"
                      : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100",
                  )}
                  data-testid={`portfolio-switcher-option-${item.ownerUserId}`}
                >
                  <span className="min-w-0 truncate">
                    {dict.ownerOptionLabel.replace("{owner}", ownerName)}
                  </span>
                  {selected ? (
                    <span
                      className="rounded-full border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-600"
                    >
                      {dict.readonlyBadge}
                    </span>
                  ) : null}
                </DropdownMenu.Item>
              );
            })}

            <DropdownMenu.Separator className="my-1 h-px bg-slate-200" />

            <DropdownMenu.Item asChild>
              <a
                href={manageSharingHref}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 outline-none transition hover:bg-slate-100 focus:bg-slate-100 data-[highlighted]:bg-slate-100"
                data-testid="portfolio-switcher-manage-sharing"
              >
                {dict.manageSharing}
              </a>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
