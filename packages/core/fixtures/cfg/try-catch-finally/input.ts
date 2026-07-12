export function guarded(run: () => void, log: (e: unknown) => void, done: () => void): void {
  try {
    run();
  } catch (error) {
    log(error);
  } finally {
    done();
  }
}
