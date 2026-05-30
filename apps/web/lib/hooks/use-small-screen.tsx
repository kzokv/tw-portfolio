"use client";

import * as React from "react";

const SMALL_SCREEN_BREAKPOINT = 640;

export function useIsSmallScreen(): boolean {
  const [isSmall, setIsSmall] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${SMALL_SCREEN_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsSmall(window.innerWidth < SMALL_SCREEN_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsSmall(window.innerWidth < SMALL_SCREEN_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isSmall;
}
