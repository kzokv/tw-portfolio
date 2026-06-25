"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { LocaleCode } from "@vakwen/shared-types";

import { adminI18n, type AdminDictionary } from "./admin-i18n-data";

export { adminI18n };
export type { AdminDictionary };

const AdminI18nContext = createContext<AdminDictionary>(adminI18n.en);

export function AdminI18nProvider({ locale, children }: { locale: LocaleCode; children: ReactNode }) {
  const value = useMemo(() => adminI18n[locale === "zh-TW" ? "zh-TW" : "en"], [locale]);
  return <AdminI18nContext.Provider value={value}>{children}</AdminI18nContext.Provider>;
}

export function useAdminI18n(): AdminDictionary {
  return useContext(AdminI18nContext);
}

export function formatAdminRelativeTime(value: string, locale: LocaleCode, dict: AdminDictionary): string {
  const ts = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMinutes < 1) return dict.common.justNow;
  if (diffMinutes < 60) return dict.common.minuteAgo.replace("{count}", String(diffMinutes));
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return dict.common.hourAgo.replace("{count}", String(diffHours));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return dict.common.dayAgo.replace("{count}", String(diffDays));
  return new Date(value).toLocaleDateString(locale === "zh-TW" ? "zh-TW" : "en-US");
}
