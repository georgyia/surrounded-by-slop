export function findIndex(haystack: string[], needle: string): number {
  let found = -1;
  for (let i = 0; i < haystack.length; i++) {
    if (haystack[i] === needle) {
      found = i;
      break;
    }
  }
  return found;
}
