"use client";

// Phase 2C — boot-time hydrator for accent + density.
// Mounts once inside <ThemeProvider> in app/layout.tsx. Fetches
// /user-preferences on first client render, parses themeAccent and density
// via shared Zod schemas, then applies them to <html> via lib/theme.ts.
//
// Also re-applies accent when next-themes resolves a theme change (light vs
// dark), since the preset HSL triplets are mode-specific.
//
// No UI. Runs on the auth surface too (gracefully no-ops on 401 / 403).

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { densityModeSchema, themeAccentSchema } from "@vakwen/shared-types";
import type { ThemeAccent } from "@vakwen/shared-types";
import { getJson, ApiError } from "../../lib/api";
import { applyAccent, applyDensity } from "../../lib/theme";

interface PrefsResponse {
  preferences?: {
    themeAccent?: unknown;
    density?: unknown;
  } | null;
}

let cachedAccent: ThemeAccent | null = null;

export function AccentApplier(): null {
  const { resolvedTheme } = useTheme();

  // Fetch on mount and apply.
  useEffect(() => {
    let cancelled = false;
    void getJson<PrefsResponse>("/user-preferences")
      .then((res) => {
        if (cancelled) return;
        const accent = themeAccentSchema.safeParse(res?.preferences?.themeAccent);
        if (accent.success) {
          cachedAccent = accent.data;
          applyAccent(accent.data, resolvedTheme === "dark" ? "dark" : "light");
        }
        const density = densityModeSchema.safeParse(res?.preferences?.density);
        if (density.success) applyDensity(density.data);
      })
      .catch((err) => {
        // Silent fail on auth surface (401/403) — defaults stay in CSS.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-apply on theme change (light ↔ dark) so the accent mode-variant matches.
  useEffect(() => {
    if (cachedAccent) {
      applyAccent(cachedAccent, resolvedTheme === "dark" ? "dark" : "light");
    }
  }, [resolvedTheme]);

  return null;
}
