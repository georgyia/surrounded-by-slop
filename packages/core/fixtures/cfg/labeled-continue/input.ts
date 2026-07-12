export function skipRows(grid: number[][]): number {
  let count = 0;
  rows: for (const row of grid) {
    for (const cell of row) {
      if (cell < 0) {
        continue rows;
      }
      count += 1;
    }
  }
  return count;
}
