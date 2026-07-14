/**
 * Benchmark comparison and budgets (SBS-090), pure so the regression gate is
 * unit-tested — CI must provably fail on an intentional slowdown.
 *
 * Two independent checks per metric:
 * - Budget: an absolute ceiling (documented in bench/budgets.json, calibrated
 *   generously for GitHub's ubuntu runners). Breaching it always fails.
 * - Baseline: when a baseline measurement exists for the same machine, a
 *   regression beyond `tolerancePct` (default 20%) fails. Baselines are
 *   per-machine local files, never committed — cross-machine deltas are noise.
 */

export interface BenchReport {
  /** Metric name (e.g. `large.analyzeMs`) → measured value. Lower is better. */
  readonly metrics: Readonly<Record<string, number>>;
}

export interface ComparisonRow {
  readonly metric: string;
  readonly current: number;
  readonly baseline: number | undefined;
  /** Percent change vs baseline (positive = slower/bigger). */
  readonly deltaPct: number | undefined;
  readonly budget: number | undefined;
  readonly status: "ok" | "regression" | "over-budget";
}

export interface Comparison {
  readonly rows: ComparisonRow[];
  readonly failures: string[];
}

export function compareBench(
  current: BenchReport,
  baseline: BenchReport | undefined,
  budgets: Readonly<Record<string, number>>,
  tolerancePct = 20,
): Comparison {
  const rows: ComparisonRow[] = [];
  const failures: string[] = [];
  for (const [metric, value] of Object.entries(current.metrics)) {
    const base = baseline?.metrics[metric];
    const budget = budgets[metric];
    const deltaPct = base === undefined || base === 0 ? undefined : ((value - base) / base) * 100;
    let status: ComparisonRow["status"] = "ok";
    if (budget !== undefined && value > budget) {
      status = "over-budget";
      failures.push(`${metric}: ${round(value)} exceeds its budget of ${budget}`);
    } else if (deltaPct !== undefined && deltaPct > tolerancePct) {
      status = "regression";
      failures.push(
        `${metric}: ${round(value)} is ${round(deltaPct)}% over the baseline ${round(base ?? 0)} (tolerance ${tolerancePct}%)`,
      );
    }
    rows.push({ metric, current: value, baseline: base, deltaPct, budget, status });
  }
  return { rows, failures };
}

/** The comparison as an aligned text table for terminals and CI logs. */
export function formatComparison(comparison: Comparison): string {
  const header = ["metric", "current", "baseline", "delta", "budget", "status"];
  const lines = [header];
  for (const row of comparison.rows) {
    lines.push([
      row.metric,
      String(round(row.current)),
      row.baseline === undefined ? "—" : String(round(row.baseline)),
      row.deltaPct === undefined ? "—" : `${row.deltaPct >= 0 ? "+" : ""}${round(row.deltaPct)}%`,
      row.budget === undefined ? "—" : String(row.budget),
      row.status,
    ]);
  }
  const widths = header.map((_, column) =>
    Math.max(...lines.map((line) => (line[column] ?? "").length)),
  );
  return lines
    .map((line) => line.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  "))
    .join("\n");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
