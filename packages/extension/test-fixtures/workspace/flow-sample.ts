export function pickLane(load: number): string {
  if (load > 90) {
    return "shed";
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (probe(attempt)) {
      return "fast";
    }
  }
  return "slow";
}

function probe(attempt: number): boolean {
  return attempt % 2 === 0;
}
