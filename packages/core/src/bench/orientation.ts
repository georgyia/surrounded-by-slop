import type { GraphLayout, LayoutPoint } from "../layout/layout.js";

export interface OrientationMetrics {
  crossings: number;
  aspectRatio: number;
  width: number;
  height: number;
}

function properIntersection(
  a: LayoutPoint,
  b: LayoutPoint,
  c: LayoutPoint,
  d: LayoutPoint,
): boolean {
  const turn = (p: LayoutPoint, q: LayoutPoint, r: LayoutPoint): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = turn(a, b, c);
  const abD = turn(a, b, d);
  const cdA = turn(c, d, a);
  const cdB = turn(c, d, b);
  // Count only a proper crossing. Collinear overlaps and shared endpoints are
  // routing details, not the visual edge-crossings this experiment measures.
  return abC * abD < 0 && cdA * cdB < 0;
}

/** Geometry-only readability metrics for comparing two layouts of one graph. */
export function orientationMetrics(layout: GraphLayout): OrientationMetrics {
  let crossings = 0;
  for (let left = 0; left < layout.edges.length; left += 1) {
    const a = layout.edges[left];
    if (a === undefined) {
      continue;
    }
    for (let right = left + 1; right < layout.edges.length; right += 1) {
      const b = layout.edges[right];
      if (b === undefined) {
        continue;
      }
      for (let i = 1; i < a.points.length; i += 1) {
        for (let j = 1; j < b.points.length; j += 1) {
          const a0 = a.points[i - 1];
          const a1 = a.points[i];
          const b0 = b.points[j - 1];
          const b1 = b.points[j];
          if (a0 && a1 && b0 && b1 && properIntersection(a0, a1, b0, b1)) {
            crossings += 1;
          }
        }
      }
    }
  }
  return {
    crossings,
    aspectRatio: layout.height === 0 ? 0 : layout.width / layout.height,
    width: layout.width,
    height: layout.height,
  };
}
