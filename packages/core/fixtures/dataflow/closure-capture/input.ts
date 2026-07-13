export function makeCounter(start: number): () => number {
  let count = start;
  const bump = (): number => {
    count += 1;
    return count;
  };
  return bump;
}
