export function outer(): number {
  const seed = 2;

  function middle(): number {
    function innermost(): number {
      return seed;
    }
    const viaConst = (): number => seed + 1;
    return seed;
  }

  return seed;
}
