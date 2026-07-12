export function sum(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i] ?? 0;
  }
  return total;
}
