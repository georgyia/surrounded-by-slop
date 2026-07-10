function parse(input: string): number;
function parse(input: boolean): string;
function parse(input: unknown): unknown {
  return input;
}

export function useBoth(): void {
  parse("text");
  parse(true);
}
