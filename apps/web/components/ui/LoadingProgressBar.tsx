"use client";

import { useEffect, useRef, useState } from "react";
import type { LocaleCode } from "@vakwen/shared-types";
import { getRouteLoadingLabels } from "../layout/i18n";
import { resolveClientLocale } from "../../lib/i18n/clientLocale";

/**
 * Top-of-page loading progress bar shown during initial document load.
 *
 * - Lightweight: two divs, requestAnimationFrame + a small interval.
 * - Hydration-safe: state starts at 0, all animations start post-mount.
 * - UX: quick ramp to ~28%, slow creep toward ~80% on long loads, then 100%.
 * - Fast loads: minimum visible duration 450ms (recommended) to avoid a jarring flash.
 * - Cleanup: fully clears rAF, timeouts, and intervals on unmount.
 */
export function LoadingProgressBar() {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [locale, setLocale] = useState<LocaleCode>("en");

  const rafIdRef = useRef<number | null>(null);
  const slowIntervalRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const slowStartTimeoutRef = useRef<number | null>(null);
  const visibleSinceRef = useRef<number | null>(null);
  const loadHandledRef = useRef(false);

  useEffect(() => {
    setLocale(resolveClientLocale());
  }, []);

  useEffect(() => {
    if (done) return;

    const INITIAL_RAMP_DURATION = 320; // ms
    const INITIAL_TARGET = 28; // %
    const SLOW_TARGET = 80; // %
    const SLOW_STEP = 4; // %
    const SLOW_INTERVAL = 600; // ms
    const SLOW_START_DELAY = 350; // ms after initial ramp end
    const MIN_VISIBLE_MS = 450; // recommended min visible time so users see "in progress"
    const HIDE_DELAY_MS = 180; // time to stay at 100% before unmount

    let rampStartTime: number | null = null;

    const clearRaf = () => {
      if (rafIdRef.current != null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const clearSlowInterval = () => {
      if (slowIntervalRef.current != null) {
        window.clearInterval(slowIntervalRef.current);
        slowIntervalRef.current = null;
      }
    };

    const clearHideTimeout = () => {
      if (hideTimeoutRef.current != null) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    const clearSlowStartTimeout = () => {
      if (slowStartTimeoutRef.current != null) {
        window.clearTimeout(slowStartTimeoutRef.current);
        slowStartTimeoutRef.current = null;
      }
    };

    const startSlowProgress = () => {
      if (slowIntervalRef.current != null) return;

      slowIntervalRef.current = window.setInterval(() => {
        setProgress((prev) => {
          if (prev >= SLOW_TARGET) {
            if (slowIntervalRef.current != null) {
              window.clearInterval(slowIntervalRef.current);
              slowIntervalRef.current = null;
            }
            return prev;
          }
          const next = Math.min(prev + SLOW_STEP, SLOW_TARGET);
          if (visibleSinceRef.current == null && next > 0) {
            visibleSinceRef.current = performance.now();
          }
          return next;
        });
      }, SLOW_INTERVAL);
    };

    const finalize = () => {
      clearRaf();
      clearSlowInterval();
      clearSlowStartTimeout();

      const now = performance.now ? performance.now() : Date.now();
      const visibleSince = visibleSinceRef.current;
      const elapsedVisible = visibleSince != null ? now - visibleSince : 0;
      const remainingMin = Math.max(0, MIN_VISIBLE_MS - elapsedVisible);

      setProgress(100);
      clearHideTimeout();
      hideTimeoutRef.current = window.setTimeout(
        () => setDone(true),
        remainingMin + HIDE_DELAY_MS,
      );
    };

    const tick = (now: number) => {
      if (rampStartTime == null) rampStartTime = now;
      const elapsed = now - rampStartTime;
      const t = Math.min(elapsed / INITIAL_RAMP_DURATION, 1);
      const easeOut = 1 - (1 - t) * (1 - t);
      const next = easeOut * INITIAL_TARGET;

      setProgress((prev) => {
        const value = Math.max(prev, next);
        if (visibleSinceRef.current == null && value > 0) {
          visibleSinceRef.current = performance.now();
        }
        return value;
      });

      if (t < 1) {
        rafIdRef.current = window.requestAnimationFrame(tick);
      } else if (!loadHandledRef.current) {
        // Only start slow progress if load has not already completed.
        clearRaf();
        clearSlowStartTimeout();
        slowStartTimeoutRef.current = window.setTimeout(startSlowProgress, SLOW_START_DELAY);
      }
    };

    const handleLoad = () => {
      if (loadHandledRef.current) return;
      loadHandledRef.current = true;
      finalize();
    };

    // Start initial ramp and wire up load event.
    rafIdRef.current = window.requestAnimationFrame(tick);

    if (document.readyState === "complete") {
      // If the document has already loaded, finalize immediately but still
      // respect the minimum visible time via finalize().
      handleLoad();
    } else {
      window.addEventListener("load", handleLoad, { once: true });
    }

    return () => {
      clearRaf();
      clearSlowInterval();
      clearHideTimeout();
      clearSlowStartTimeout();
      window.removeEventListener("load", handleLoad);
    };
  }, [done]);

  if (done) return null;
  const copy = getRouteLoadingLabels(locale).dashboard;

  return (
    <div
      className="loading-progress"
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={copy.ariaLabel}
      aria-live="off"
    >
      <div className="loading-progress__bar" style={{ width: `${progress}%` }} />
    </div>
  );
}
