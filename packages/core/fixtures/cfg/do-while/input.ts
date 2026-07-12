export function atLeastOnce(n: number): number {
  let tries = 0;
  do {
    tries += 1;
  } while (tries < n);
  return tries;
}
