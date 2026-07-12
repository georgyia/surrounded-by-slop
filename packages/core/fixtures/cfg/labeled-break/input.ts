export function findPair(grid: number[][], target: number): boolean {
  let found = false;
  outer: for (const row of grid) {
    for (const cell of row) {
      if (cell === target) {
        found = true;
        break outer;
      }
    }
  }
  return found;
}
