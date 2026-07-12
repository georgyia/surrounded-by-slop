export async function fetchTotal(load: (id: number) => Promise<number>): Promise<number> {
  let total = 0;
  for (const id of [1, 2, 3]) {
    const value = await load(id);
    total += value;
  }
  return total;
}
