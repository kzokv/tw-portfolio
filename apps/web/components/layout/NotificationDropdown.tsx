"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Info, X, XCircle } from "lucide-react";
import type { NotificationDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { Button } from "../ui/Button";

interface NotificationDropdownProps {
  notifications: NotificationDto[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClose: () => void;
  dict: AppDictionary;
}

function severityIcon(severity: string) {
  switch (severity) {
    case "error":
      return <XCircle className="h-4 w-4 shrink-0 text-rose-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
    default:
      return <Info className="h-4 w-4 shrink-0 text-sky-500" />;
  }
}

function formatRelativeTime(isoDate: string, dict: AppDictionary["notifications"]): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return dict.timeJustNow;
  if (diffMinutes < 60) return dict.timeMinutesAgo.replace("{count}", String(diffMinutes));
  if (diffHours < 24) return dict.timeHoursAgo.replace("{count}", String(diffHours));
  return dict.timeDaysAgo.replace("{count}", String(diffDays));
}

export function NotificationDropdown({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClose,
  dict,
}: NotificationDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-[calc(100%+0.75rem)] z-[80] w-[22rem] rounded-[26px] border border-slate-200 bg-white p-3 shadow-[0_22px_55px_rgba(15,23,42,0.14)]"
      data-testid="notification-dropdown"
    >
      <div className="flex items-center justify-between px-2 pb-2">
        <h3 className="text-sm font-semibold text-slate-950">{dict.notifications.dropdownTitle}</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-full px-2 text-[11px]"
          onClick={onMarkAllRead}
          data-testid="notification-mark-all-read"
        >
          {dict.notifications.markAllRead}
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-slate-500" data-testid="notification-empty">
          {dict.notifications.emptyState}
        </div>
      ) : (
        <div className="max-h-[20rem] overflow-y-auto">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="group flex items-start gap-3 rounded-[20px] px-3 py-3 transition hover:bg-slate-50"
              data-testid={`notification-item-${notification.id}`}
              role="button"
              tabIndex={0}
              onClick={() => onMarkRead(notification.id)}
              onKeyDown={(e) => { if (e.key === "Enter") onMarkRead(notification.id); }}
            >
              <div className="mt-0.5">{severityIcon(notification.severity)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="flex-1 truncate text-sm font-medium text-slate-900">{notification.title}</p>
                  {!notification.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" data-testid={`notification-unread-${notification.id}`} />
                  )}
                </div>
                {notification.body && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">{notification.body}</p>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  {formatRelativeTime(notification.createdAt, dict.notifications)}
                </p>
              </div>
              <button
                type="button"
                className="mt-0.5 rounded-full p-1 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
                aria-label={dict.actions.dismiss}
                data-testid={`notification-dismiss-${notification.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
