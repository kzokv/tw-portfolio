import { z } from "zod";
import { routeError } from "../lib/routeError.js";

export const BOOKED_CHARGE_MAX_DECIMALS = 4;

function countDecimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (!text.includes("e")) {
    const decimalPoint = text.indexOf(".");
    return decimalPoint === -1 ? 0 : text.length - decimalPoint - 1;
  }

  const [mantissa, exponentText] = text.split("e");
  const exponent = Number(exponentText);
  const decimalPoint = mantissa.indexOf(".");
  const mantissaDecimals = decimalPoint === -1 ? 0 : mantissa.length - decimalPoint - 1;
  return Math.max(0, mantissaDecimals - exponent);
}

export function isValidBookedCharge(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && countDecimalPlaces(value) <= BOOKED_CHARGE_MAX_DECIMALS;
}

export function bookedChargeMessage(label: string): string {
  return `${label} must be a non-negative finite number with at most ${BOOKED_CHARGE_MAX_DECIMALS} decimal places`;
}

export const bookedChargeSchema = z.number().refine(isValidBookedCharge, {
  message: bookedChargeMessage("Booked charge"),
});

export function bookedChargeFieldSchema(label: string) {
  return z.number().refine(isValidBookedCharge, {
    message: bookedChargeMessage(label),
  });
}

export function assertBookedCharge(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!isValidBookedCharge(value)) {
    throw routeError(400, "invalid_charge", bookedChargeMessage(label));
  }
}
