export const TRADING_LIMITS = Object.freeze({
  maxQuantity: 1_000_000,
  maxUnitPrice: 100_000_000,
  maxOrderTotal: 1_000_000_000,
});

export const positiveInt = (value, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= max
    ? number
    : null;
};

export const safeOrderTotal = (unitPrice, quantity) => {
  const total = unitPrice * quantity;
  return Number.isSafeInteger(unitPrice) &&
    Number.isSafeInteger(quantity) &&
    Number.isSafeInteger(total) &&
    total > 0 &&
    total <= TRADING_LIMITS.maxOrderTotal
    ? total
    : null;
};

export const limitLabel = (value) => value.toLocaleString("ko-KR");
