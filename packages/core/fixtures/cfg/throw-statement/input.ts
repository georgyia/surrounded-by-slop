export function parsePositive(raw: string): number {
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`not a number: ${raw}`);
  }
  return value;
}
