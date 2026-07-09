export function parse(input: string): number;
export function parse(input: boolean): string;
export function parse(input: unknown): unknown {
  return typeof input === "string" ? 1 : "one";
}
