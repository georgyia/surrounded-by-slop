const stock = new Map<string, number>([
  ["widget", 12],
  ["gadget", 3],
  ["gizmo", 0],
]);

export function available(sku: string): number {
  return stock.get(sku) ?? 0;
}

export function inStock(sku: string): boolean {
  return available(sku) > 0;
}

export function reserve(sku: string, quantity: number): boolean {
  const remaining = available(sku);
  if (remaining < quantity) {
    return false;
  }
  stock.set(sku, remaining - quantity);
  return true;
}
