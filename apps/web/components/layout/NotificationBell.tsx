"use client";

import { Bell } from "lucide-react";
import type { NotificationDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { Button } from "../ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/shadcn/popover";
import { NotificationDropdown } from "./NotificationDropdown";
import { cn } from "../../lib/utils";

interface NotificationBellProps {
  unreadCount: number;
  notifications: NotificationDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  dict: AppDictionary;
  className?: string;
}

/**
 * Topbar notification bell. shadcn `Popover` handles open-state + click-outside
 * dismissal natively, so the legacy `useEffect` mousedown handler in
 * `NotificationDropdown` is removed.
 *
 * Locked testids (design §2):
 *   - `topbar-notification-bell` — wrapper carrying the popover anchor.
 *   - `notification-bell-button` — the trigger button.
 *   - `notification-bell-unread-count` — unread badge.
 *   - `topbar-notification-popover` / `notification-popover-content` — content root.
 *
 * Preserves §8 item 11 — `useNotifications` lives in AppShell with
 * `enabled: true` (SSE pre-connect). This component receives the resolved
 * notifications + handlers as props, so the SSE channel is unaffected by
 * popover open/close transitions.
 */
export function NotificationBell({
  unreadCount,
  notifications,
  open,
  onOpenChange,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  dict,
  className,
}: NotificationBellProps) {
  return (
    <div className={cn("relative shrink-0", className)} data-testid="topbar-notification-bell">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="relative h-10 w-10 rounded-full"
            aria-label={dict.notifications.bellLabel}
            data-testid="notification-bell-button"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-[0_2px_6px_rgba(244,63,94,0.4)]"
                data-testid="notification-bell-unread-count"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[22rem] p-0"
          data-testid="topbar-notification-popover"
        >
          <NotificationDropdown
            notifications={notifications}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onDismiss={onDismiss}
            dict={dict}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
