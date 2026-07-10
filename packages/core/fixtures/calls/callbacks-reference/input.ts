function each(items: number[], visit: (item: number) => void): void {
  for (const item of items) {
    visit(item);
  }
}

function handler(item: number): void {
  const seen = item;
}

export function run(): void {
  each([1, 2], handler);
}
