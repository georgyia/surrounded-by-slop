export function table(n: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      row.push(i * j);
    }
    rows.push(row);
  }
  return rows;
}
