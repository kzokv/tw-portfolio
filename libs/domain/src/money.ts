import type { RoundingMode } from "./types.js";

export function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === "FLOOR") return Math.floor(value);
  if (mode === "CEIL") return Math.ceil(value);
  return Math.round(value);
}

export function bpsAmount(baseAmount: number, bps: number): number {
  return (baseAmount * bps) / 10_000;
}

export function permilleAmount(baseAmount: number, permilleRate: number): number {
  return (baseAmount * permilleRate) / 1_000;
}
