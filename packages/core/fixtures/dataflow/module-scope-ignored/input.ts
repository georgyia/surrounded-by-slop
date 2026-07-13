const RATE = 0.19;

export function gross(net: number): number {
  return net * (1 + RATE);
}
