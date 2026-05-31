"use client";

import { useEffect, useState } from "react";
import { CONTEXT_CHANGED_EVENT, readContextCookie } from "../lib/context";

interface ContextChangedDetail {
  ownerUserId: string | null;
}

export function useSharedContextOwnerId(): string | null {
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);

  useEffect(() => {
    setOwnerUserId(readContextCookie());

    function handleContextChanged(event: Event): void {
      const detail = (event as CustomEvent<ContextChangedDetail>).detail;
      setOwnerUserId(detail?.ownerUserId ?? null);
    }

    window.addEventListener(CONTEXT_CHANGED_EVENT, handleContextChanged as EventListener);
    return () => {
      window.removeEventListener(CONTEXT_CHANGED_EVENT, handleContextChanged as EventListener);
    };
  }, []);

  return ownerUserId;
}
