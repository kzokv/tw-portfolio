"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Observes whether a target element is visible in the viewport.
 * Returns `isVisible: false` when the element scrolls out of view.
 *
 * Used to trigger a floating bubble when the stats bar leaves the viewport.
 */
export function useElementVisibility() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { targetRef, isVisible };
}
