import { describe, expect, it } from "vitest";
import type { GraphLayout } from "../layout/layout.js";
import { orientationMetrics } from "./orientation.js";

describe("orientationMetrics", () => {
  it("counts proper edge crossings and reports the bounding-box ratio", () => {
    const layout: GraphLayout = {
      width: 200,
      height: 100,
      nodes: [],
      edges: [
        {
          id: "a",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
        {
          id: "b",
          points: [
            { x: 0, y: 100 },
            { x: 100, y: 0 },
          ],
        },
        {
          id: "touch",
          points: [
            { x: 100, y: 100 },
            { x: 150, y: 100 },
          ],
        },
      ],
    };
    expect(orientationMetrics(layout)).toEqual({
      crossings: 1,
      aspectRatio: 2,
      width: 200,
      height: 100,
    });
  });
});
