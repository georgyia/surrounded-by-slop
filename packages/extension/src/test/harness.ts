/**
 * A ~40-line test collector for the Extension Development Host, in place of a
 * full framework. `@vscode/test-electron` only asks the test bundle to export a
 * `run(): Promise<void>` that resolves on success and rejects on failure — a
 * dependency on Mocha buys us nothing the project's rules would thank us for.
 */

type TestFn = () => void | Promise<void>;

interface RegisteredTest {
  readonly name: string;
  readonly fn: TestFn;
}

const registered: RegisteredTest[] = [];

/** Register a test. Call at module top level; the suite runs them in order. */
export function test(name: string, fn: TestFn): void {
  registered.push({ name, fn });
}

/** Reject if `promise` has not settled within `ms`, so a hung round-trip fails loudly. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Run every registered test; reject if any fails, so the launcher exits non-zero. */
export async function runAll(): Promise<void> {
  const failures: string[] = [];
  for (const { name, fn } of registered) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      failures.push(`✗ ${name}\n${detail}`);
      console.error(`  ✗ ${name}`);
      console.error(detail);
    }
  }
  console.log(`\n${registered.length - failures.length}/${registered.length} passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration test(s) failed:\n\n${failures.join("\n\n")}`);
  }
}
