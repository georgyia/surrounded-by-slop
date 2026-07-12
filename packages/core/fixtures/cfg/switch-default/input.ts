export function bucket(n: number): string {
  switch (n) {
    case 0:
      return "zero";
    case 1:
      return "one";
    default:
      return "many";
  }
}
