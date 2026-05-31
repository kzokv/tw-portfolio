"use client";

import { createContext, useContext } from "react";
import type { SharingRouteContextValue } from "../../features/sharing/types";

const SharingRouteContext = createContext<SharingRouteContextValue | null>(null);

interface SharingRouteProviderProps {
  value: SharingRouteContextValue;
  children: React.ReactNode;
}

export function SharingRouteProvider({ value, children }: SharingRouteProviderProps) {
  return (
    <SharingRouteContext.Provider value={value}>
      {children}
    </SharingRouteContext.Provider>
  );
}

export function useSharingRouteContext(): SharingRouteContextValue {
  const context = useContext(SharingRouteContext);
  if (!context) {
    throw new Error("Sharing route context is not available.");
  }

  return context;
}
