"use client";

import { Bell } from "lucide-react";
import { Button } from "../ui/Button";

interface NotificationBellProps {
  unreadCount: number;
  onClick: () => void;
  label: string;
}

export function NotificationBell({ unreadCount, onClick, label }: NotificationBellProps) {
  return (
    <Button
      variant="secondary"
      className="relative h-11 w-11 shrink-0 rounded-full"
      onClick={onClick}
      aria-label={label}
      data-testid="notification-bell"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-[0_2px_6px_rgba(244,63,94,0.4)]"
          data-testid="notification-badge"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  );
}
