"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export interface SettingsRouteContextValue {
  isDemo: boolean;
  locale: LocaleCode;
  profile: ProfileWithImpersonationDto;
  initialSidebarOpen: boolean;
  initialSettings: UserSettings | null;
}

const SettingsRouteContext = createContext<SettingsRouteContextValue | null>(null);

interface SettingsRouteProviderProps {
  value: SettingsRouteContextValue;
  children: ReactNode;
}

export function SettingsRouteProvider({ value, children }: SettingsRouteProviderProps) {
  return (
    <SettingsRouteContext.Provider value={value}>{children}</SettingsRouteContext.Provider>
  );
}

export function useSettingsRouteContext(): SettingsRouteContextValue {
  const ctx = useContext(SettingsRouteContext);
  if (!ctx) {
    throw new Error("Settings route context is not available.");
  }
  return ctx;
}
