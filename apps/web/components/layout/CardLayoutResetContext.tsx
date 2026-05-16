"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface CardLayoutResetCounts {
  dashboard: number;
  transactions: number;
  portfolio: number;
}

const DEFAULT: CardLayoutResetCounts = { dashboard: 0, transactions: 0, portfolio: 0 };

const Ctx = createContext<CardLayoutResetCounts>(DEFAULT);

export function CardLayoutResetProvider({
  value,
  children,
}: {
  value: CardLayoutResetCounts;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCardLayoutResetCount(page: keyof CardLayoutResetCounts): number {
  return useContext(Ctx)[page];
}
