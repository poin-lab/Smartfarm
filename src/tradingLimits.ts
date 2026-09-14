export const tradingLimits = Object.freeze({
  maxQuantity: 1_000_000,
  maxUnitPrice: 100_000_000,
  maxOrderTotal: 1_000_000_000,
});

export const validPositiveInt = (value: number, max: number) =>
  Number.isSafeInteger(value) && value > 0 && value <= max;
