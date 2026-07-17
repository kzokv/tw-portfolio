export type DividendStockCalculationMethod =
  | "provider_ratio"
  | "derived_from_par_value"
  | "custom_ratio";

export type DividendStockProviderValueUnit =
  | "RATIO"
  | "TWD_PER_SHARE"
  | "UNKNOWN";

export interface DividendStockCalculationInput {
  eligibleQuantity: number;
  method: DividendStockCalculationMethod;
  providerValue?: string | null;
  providerUnit?: DividendStockProviderValueUnit | null;
  selectedParValue?: string | null;
  customRatio?: string | null;
}

export interface DividendStockCalculationResult {
  method: DividendStockCalculationMethod;
  ratio: string;
  providerValue: string | null;
  providerUnit: DividendStockProviderValueUnit | null;
  selectedParValue: string | null;
  theoreticalShares: string;
  expectedWholeShares: number;
  fractionalRemainder: string;
  requiresHighRatioConfirmation: boolean;
}

type ParsedDecimal = {
  numerator: bigint;
  scale: number;
};

const MAX_SCALE = 12;

export function calculateDividendStockEntitlement(
  input: DividendStockCalculationInput,
): DividendStockCalculationResult {
  const eligibleQuantity = normalizeEligibleQuantity(input.eligibleQuantity);
  const providerValue = normalizeOptionalDecimal(input.providerValue);
  const selectedParValue = normalizeOptionalDecimal(input.selectedParValue);
  const customRatio = normalizeOptionalDecimal(input.customRatio);
  const providerUnit = input.providerUnit ?? null;

  const calculation = resolveCalculation(input.method, eligibleQuantity, {
    providerValue,
    providerUnit,
    selectedParValue,
    customRatio,
  });
  const { ratio, theoreticalShares } = calculation;
  const expectedWholeSharesBigInt = theoreticalShares.numerator / scaleFactor(theoreticalShares.scale);

  if (expectedWholeSharesBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expected_whole_shares_overflow");
  }

  const remainderNumerator = theoreticalShares.numerator % scaleFactor(theoreticalShares.scale);

  return {
    method: input.method,
    ratio: formatDecimal(ratio),
    providerValue: providerValue ? formatDecimal(providerValue) : null,
    providerUnit,
    selectedParValue: selectedParValue ? formatDecimal(selectedParValue) : null,
    theoreticalShares: formatDecimal(theoreticalShares),
    expectedWholeShares: Number(expectedWholeSharesBigInt),
    fractionalRemainder: formatDecimal({ numerator: remainderNumerator, scale: theoreticalShares.scale }),
    requiresHighRatioConfirmation: calculation.requiresHighRatioConfirmation,
  };
}

function resolveCalculation(
  method: DividendStockCalculationMethod,
  eligibleQuantity: bigint,
  input: {
    providerValue: ParsedDecimal | null;
    providerUnit: DividendStockProviderValueUnit | null;
    selectedParValue: ParsedDecimal | null;
    customRatio: ParsedDecimal | null;
  },
): {
  ratio: ParsedDecimal;
  theoreticalShares: ParsedDecimal;
  requiresHighRatioConfirmation: boolean;
} {
  if (method === "provider_ratio") {
    if (input.providerUnit !== "RATIO") {
      throw new Error("provider_unit_incompatible");
    }
    const ratio = requirePositiveDecimal(input.providerValue, "provider_value_must_be_finite_positive");
    return {
      ratio,
      theoreticalShares: multiplyDecimalByInteger(ratio, eligibleQuantity),
      requiresHighRatioConfirmation: compareDecimal(ratio, { numerator: 1n, scale: 0 }) > 0,
    };
  }

  if (method === "derived_from_par_value") {
    if (input.providerUnit !== "TWD_PER_SHARE") {
      throw new Error("provider_unit_incompatible");
    }
    const providerValue = requirePositiveDecimal(input.providerValue, "provider_value_must_be_finite_positive");
    const selectedParValue = requirePositiveDecimal(input.selectedParValue, "par_value_must_be_finite_positive");
    return {
      ratio: divideDecimal(providerValue, selectedParValue, MAX_SCALE),
      theoreticalShares: divideDecimal(
        multiplyDecimalByInteger(providerValue, eligibleQuantity),
        selectedParValue,
        MAX_SCALE,
      ),
      requiresHighRatioConfirmation: compareDecimal(providerValue, selectedParValue) > 0,
    };
  }

  const ratio = requirePositiveDecimal(input.customRatio, "ratio_must_be_positive");
  return {
    ratio,
    theoreticalShares: multiplyDecimalByInteger(ratio, eligibleQuantity),
    requiresHighRatioConfirmation: compareDecimal(ratio, { numerator: 1n, scale: 0 }) > 0,
  };
}

function normalizeEligibleQuantity(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error("eligible_quantity_must_be_positive_integer");
  }
  return BigInt(value);
}

function requirePositiveDecimal(value: ParsedDecimal | null, errorCode: string): ParsedDecimal {
  if (value == null || value.numerator <= 0n) {
    throw new Error(errorCode);
  }
  return value;
}

function normalizeOptionalDecimal(value: string | null | undefined): ParsedDecimal | null {
  if (value == null) return null;
  return parsePositiveFiniteDecimal(value);
}

function parsePositiveFiniteDecimal(raw: string): ParsedDecimal {
  const text = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { numerator: -1n, scale: 0 };
  }
  const [whole, fraction = ""] = text.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const scale = trimmedFraction.length;
  const digits = `${whole}${trimmedFraction}`;
  return {
    numerator: BigInt(digits === "" ? "0" : digits),
    scale,
  };
}

function multiplyDecimalByInteger(value: ParsedDecimal, multiplier: bigint): ParsedDecimal {
  return {
    numerator: value.numerator * multiplier,
    scale: value.scale,
  };
}

function divideDecimal(left: ParsedDecimal, right: ParsedDecimal, maxScale: number): ParsedDecimal {
  const numerator = left.numerator * scaleFactor(right.scale + maxScale);
  const denominator = right.numerator * scaleFactor(left.scale);
  return normalizeDecimal({
    numerator: numerator / denominator,
    scale: maxScale,
  });
}

function compareDecimal(left: ParsedDecimal, right: ParsedDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.numerator * scaleFactor(scale - left.scale);
  const rightScaled = right.numerator * scaleFactor(scale - right.scale);
  if (leftScaled === rightScaled) return 0;
  return leftScaled > rightScaled ? 1 : -1;
}

function normalizeDecimal(value: ParsedDecimal): ParsedDecimal {
  let numerator = value.numerator;
  let scale = value.scale;
  while (scale > 0 && numerator % 10n === 0n) {
    numerator /= 10n;
    scale -= 1;
  }
  return { numerator, scale };
}

function formatDecimal(value: ParsedDecimal): string {
  const normalized = normalizeDecimal(value);
  const negative = normalized.numerator < 0n;
  const digits = `${negative ? -normalized.numerator : normalized.numerator}`;
  if (normalized.scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const padded = digits.padStart(normalized.scale + 1, "0");
  const whole = padded.slice(0, -normalized.scale);
  const fraction = padded.slice(-normalized.scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function scaleFactor(scale: number): bigint {
  return BigInt(`1${"0".repeat(scale)}`);
}
