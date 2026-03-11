import type { RoundingMode } from "./types.js";

export function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === "FLOOR") return Math.floor(value);
  if (mode === "CEIL") return Math.ceil(value);
  return Math.round(value);
}

export function bpsAmount(baseNtd: number, bps: number): number {
  return (baseNtd * bps) / 10_000;
}

export function permilleAmount(baseNtd: number, permilleRate: number): number {
  return (baseNtd * permilleRate) / 1_000;
}
