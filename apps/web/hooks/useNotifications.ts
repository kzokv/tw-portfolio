"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationDto, NotificationListResponse, UnreadCountResponse } from "@vakwen/shared-types";
import { deleteJson, getJson, patchJson } from "../lib/api";
import { useEventStream } from "./useEventStream";

export interface UseNotificationsReturn {
  notifications: NotificationDto[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

interface UseNotificationsOptions {
  onSharingNotification?: (notification: NotificationDto) => void;
}

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const mounted = useRef(true);
  const latestSharingNotificationIdRef = useRef<string | null>(null);
  const onSharingNotificationRef = useRef(options.onSharingNotification);
  onSharingNotificationRef.current = options.onSharingNotification;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refetch = useCallback(async (emitSharingNotification = false) => {
    setIsLoading(true);
    try {
      const [listRes, countRes] = await Promise.all([
        getJson<NotificationListResponse>("/notifications?page=1&limit=20"),
        getJson<UnreadCountResponse>("/notifications/unread-count"),
      ]);
      if (!mounted.current) return;
      setNotifications(listRes.notifications);
      setUnreadCount(countRes.count);
      const latestSharingNotification =
        listRes.notifications.find((item) => item.source === "sharing") ?? null;
      const latestSharingNotificationId = latestSharingNotification?.id ?? null;

      if (
        emitSharingNotification
        && latestSharingNotification
        && latestSharingNotificationId
        && latestSharingNotificationId !== latestSharingNotificationIdRef.current
      ) {
        onSharingNotificationRef.current?.(latestSharingNotification);
      }

      latestSharingNotificationIdRef.current = latestSharingNotificationId;
    } catch {
      // API may not be available yet — silently ignore
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void refetch(false);
  }, [refetch]);

  // SSE: refetch when notification-producing flows complete.
  const handleSSEEvent = useCallback((eventData: unknown) => {
    const event = eventData as { type?: string } | null;
    const emitSharingNotification = event?.type === "sharing_notification";
    void refetch(emitSharingNotification);
  }, [refetch]);

  useEventStream({
    eventTypes: ["daily_refresh_summary", "repair_complete", "repair_failed", "sharing_notification"],
    onEvent: handleSSEEvent,
    enabled: true,
  });

  const markRead = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await patchJson(`/notifications/${id}/read`, {});
    } catch {
      // Revert on failure
      void refetch();
    }
  }, [refetch]);

  const markAllRead = useCallback(async () => {
    // Optimistic update
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: now })),
    );
    setUnreadCount(0);
    try {
      await patchJson("/notifications/read-all", {});
    } catch {
      // Revert on failure
      void refetch();
    }
  }, [refetch]);

  const dismiss = useCallback(async (id: string) => {
    // Optimistic update — remove from list
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteJson(`/notifications/${id}`);
      // Refetch to get accurate unread count
      const countRes = await getJson<UnreadCountResponse>("/notifications/unread-count");
      if (mounted.current) setUnreadCount(countRes.count);
    } catch {
      void refetch();
    }
  }, [refetch]);

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    dismiss,
    refetch,
  };
}
