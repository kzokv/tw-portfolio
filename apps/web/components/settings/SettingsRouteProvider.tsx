"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface SettingsRouteProviderValue {
  isDemo: boolean;
  locale: LocaleCode;
  profile: ProfileWithImpersonationDto;
  initialSidebarOpen: boolean;
  initialSettings: UserSettings | null;
}

export interface SettingsRouteContextValue extends SettingsRouteProviderValue {
  setLocale: (locale: LocaleCode) => void;
}

const SettingsRouteContext = createContext<SettingsRouteContextValue | null>(null);

interface SettingsRouteProviderProps {
  value: SettingsRouteProviderValue;
  children: ReactNode;
}

export function SettingsRouteProvider({ value, children }: SettingsRouteProviderProps) {
  const [locale, setLocaleState] = useState<LocaleCode>(value.locale);
  const [initialSettings, setInitialSettings] = useState<UserSettings | null>(
    value.initialSettings,
  );

  useEffect(() => {
    setLocaleState(value.locale);
    setInitialSettings(value.initialSettings);
  }, [value.initialSettings, value.locale]);

  const setLocale = useCallback((nextLocale: LocaleCode) => {
    setLocaleState(nextLocale);
    setInitialSettings((currentSettings) =>
      currentSettings ? { ...currentSettings, locale: nextLocale } : currentSettings,
    );
  }, []);

  const contextValue = useMemo<SettingsRouteContextValue>(
    () => ({ ...value, locale, initialSettings, setLocale }),
    [initialSettings, locale, setLocale, value],
  );

  return (
    <SettingsRouteContext.Provider value={contextValue}>
      {children}
    </SettingsRouteContext.Provider>
  );
}

export function useSettingsRouteContext(): SettingsRouteContextValue {
  const ctx = useContext(SettingsRouteContext);
  if (!ctx) {
    throw new Error("Settings route context is not available.");
  }
  return ctx;
}
