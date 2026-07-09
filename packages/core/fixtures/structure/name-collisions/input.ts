export function choose(flag: boolean): number {
  if (flag) {
    function pick(): number {
      return 1;
    }
    const marker = 1;
    return marker;
  } else {
    function pick(): number {
      return 2;
    }
    const marker = 2;
    return marker;
  }
}
