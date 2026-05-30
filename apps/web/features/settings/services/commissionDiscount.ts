function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toZhFoldValue(commissionDiscountPercent: number): number {
  return roundToHundredths((100 - commissionDiscountPercent) / 10);
}

export function fromZhFoldValue(foldValue: number): number {
  return roundToHundredths(100 - foldValue * 10);
}
