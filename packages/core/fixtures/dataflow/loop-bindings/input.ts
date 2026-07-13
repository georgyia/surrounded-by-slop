export function tally(rows: number[][]): number {
  let sum = 0;
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      sum += row[i] ?? 0;
    }
  }
  return sum;
}
