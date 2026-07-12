export function firstPowerAbove(limit: number): number {
  for (let p = 1; ; p *= 2) {
    if (p > limit) {
      return p;
    }
  }
}
