export const maximumOperationalAmountKc = 1_000_000_000;

export function isBoundedKcAmount(
  value: unknown,
  minimum = -maximumOperationalAmountKc,
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximumOperationalAmountKc;
}
