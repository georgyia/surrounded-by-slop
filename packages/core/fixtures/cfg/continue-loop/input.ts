export function evens(values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (value % 2 !== 0) {
      continue;
    }
    out.push(value);
  }
  return out;
}
