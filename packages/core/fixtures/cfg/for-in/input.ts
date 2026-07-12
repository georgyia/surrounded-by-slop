export function keys(record: Record<string, number>): string[] {
  const out: string[] = [];
  for (const key in record) {
    out.push(key);
  }
  return out;
}
