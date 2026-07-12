export function withLock(run: () => number, release: () => void): number {
  try {
    return run();
  } finally {
    release();
  }
}
