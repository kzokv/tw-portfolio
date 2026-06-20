"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";

interface RollingNumberProps {
  animateOnKey?: number;
  className?: string;
  value: string;
}

interface RollingState {
  current: string;
  previous: string | null;
  isAnimating: boolean;
  isRolling: boolean;
}

type RollingPart =
  | { type: "static"; value: string }
  | { type: "digit"; from: string; to: string };

const DIGIT_CLASS_NAME = "inline-flex min-w-[0.62em] justify-center";

export function RollingNumber({
  animateOnKey = 0,
  className,
  value,
}: RollingNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const mountedRef = useRef(false);
  const currentValueRef = useRef(value);
  const lastAnimateKeyRef = useRef(animateOnKey);
  const [state, setState] = useState<RollingState>({
    current: value,
    previous: null,
    isAnimating: false,
    isRolling: false,
  });

  useEffect(() => {
    const animateKeyChanged = animateOnKey !== lastAnimateKeyRef.current;
    lastAnimateKeyRef.current = animateOnKey;

    if (!mountedRef.current) {
      mountedRef.current = true;
      currentValueRef.current = value;
      setState({ current: value, previous: null, isAnimating: false, isRolling: false });
      return;
    }

    const previousValue = currentValueRef.current;
    if (value === previousValue) return;
    currentValueRef.current = value;

    if (!animateKeyChanged || prefersReducedMotion) {
      setState({ current: value, previous: null, isAnimating: false, isRolling: false });
      return;
    }

    setState({ current: value, previous: previousValue, isAnimating: true, isRolling: false });
    const frame = window.requestAnimationFrame(() => {
      setState((current) => ({ ...current, isRolling: true }));
    });
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, previous: null, isAnimating: false, isRolling: false }));
    }, 420);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [animateOnKey, prefersReducedMotion, value]);

  const parts = useMemo(
    () => buildRollingParts(state.previous, state.current),
    [state.current, state.previous],
  );

  return (
    <span
      className={cn("inline-flex items-baseline whitespace-nowrap tabular-nums", className)}
      aria-label={state.current}
      data-rolling-active={state.isAnimating ? "true" : "false"}
    >
      <span aria-hidden="true" className="inline-flex items-baseline">
        {parts.map((part, index) => {
          if (part.type === "static") {
            return <span key={`${part.value}-${index}`}>{part.value}</span>;
          }
          return (
            <span key={`${part.from}-${part.to}-${index}`} className={cn(DIGIT_CLASS_NAME, "overflow-hidden")} style={{ height: "1em" }}>
              <span
                data-rolling-digit-track="true"
                className="inline-flex flex-col transition-transform duration-400 ease-out"
                style={{ transform: state.isRolling ? "translateY(-1em)" : "translateY(0)" }}
              >
                <span className={DIGIT_CLASS_NAME} style={{ height: "1em" }}>{part.from}</span>
                <span className={DIGIT_CLASS_NAME} style={{ height: "1em" }}>{part.to}</span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

function buildRollingParts(previous: string | null, current: string): RollingPart[] {
  if (!previous || previous.length !== current.length) {
    return current.split("").map((value) => ({ type: "static", value }));
  }

  return current.split("").map((value, index) => {
    const previousValue = previous[index] ?? "";
    if (isDigit(previousValue) && isDigit(value) && previousValue !== value) {
      return { type: "digit", from: previousValue, to: value };
    }
    return { type: "static", value };
  });
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}
