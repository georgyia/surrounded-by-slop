export function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return undefined;
  }
}
