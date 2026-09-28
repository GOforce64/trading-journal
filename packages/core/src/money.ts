/** Round to cents. Uses epsilon nudging so 1.005 -> 1.01 rather than 1.00. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)) / 100;
}

/** Sum dollar amounts, rounding once at the end to kill float drift. */
export function sumMoney(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}
