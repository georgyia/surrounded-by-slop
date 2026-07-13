export function unpack(order: { id: string; items: string[] }): string {
  const { id, items: [head = "none"] } = order;
  let [a, b] = [1, 2];
  [a, b] = [b, a];
  return `${id}:${head}:${a}${b}`;
}
