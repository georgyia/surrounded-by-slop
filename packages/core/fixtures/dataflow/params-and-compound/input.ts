export function pad(text: string, width: number, fill = " "): string {
  let out = text;
  while (out.length < width) {
    out += fill;
  }
  return out;
}
