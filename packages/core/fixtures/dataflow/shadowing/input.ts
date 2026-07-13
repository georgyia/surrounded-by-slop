export function render(theme: string): string {
  const label = theme.trim();
  if (label === "") {
    const label = "default";
    return label;
  }
  return label;
}
