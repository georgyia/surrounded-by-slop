export function guard(input: string | undefined): string {
  if (input === undefined) {
    return "";
  }
  if (input.length === 0) {
    return "";
  }
  return input.trim();
}
