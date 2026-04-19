"use client";

import { useCallback, useEffect, useState } from "react";
import type { ImpersonationDto, ProfileDto } from "@tw-portfolio/shared-types";
import { getJson } from "../../../lib/api";

// Re-export the canonical types so existing callers can import from this module
// without reaching into shared-types directly. `ProfileImpersonationDto` and
// `ProfileWithImpersonationDto` are deprecated aliases kept for backward
// compatibility during the KZO-148 code-review cleanup (M-1) — prefer the
// canonical names for new code.
export type ProfileImpersonationDto = ImpersonationDto;
export type ProfileWithImpersonationDto = ProfileDto;

export const PROFILE_REFRESH_EVENT = "tw:profile-refresh";

export function useProfile(initialProfile: ProfileDto | null = null) {
  const [profile, setProfile] = useState<ProfileDto | null>(initialProfile);

  const refresh = useCallback(async () => {
    try {
      setProfile(await getJson<ProfileDto>("/profile"));
    } catch {
      // swallow fetch errors — no UI surface for error state
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function handleRefresh(): void {
      void refresh();
    }

    window.addEventListener(PROFILE_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(PROFILE_REFRESH_EVENT, handleRefresh);
  }, [refresh]);

  return { profile, refresh };
}
