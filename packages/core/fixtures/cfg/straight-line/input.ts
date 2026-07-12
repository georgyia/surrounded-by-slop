export function greet(name: string): string {
  const upper = name.toUpperCase();
  const message = `hello ${upper}`;
  return message;
}
