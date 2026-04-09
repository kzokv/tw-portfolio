"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfileDto } from "@tw-portfolio/shared-types";

export function useProfile() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        setProfile(await res.json());
      }
    } catch {
      // swallow fetch errors — no UI surface for error state
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, refresh };
}
