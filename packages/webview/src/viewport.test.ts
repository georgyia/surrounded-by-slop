import { describe, expect, it } from "vitest";
import {
  fitViewport,
  isLowDetail,
  LOD_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  panViewport,
  toTransform,
  type Viewport,
  zoomViewport,
} from "./viewport.js";

describe("fitViewport", () => {
  it("centers small content at natural size (never enlarges past 1×)", () => {
    const view = fitViewport(100, 50, 500, 500);
    expect(view.scale).toBe(1);
    expect(view.x).toBe(200);
    expect(view.y).toBe(225);
  });

  it("scales large content down to fit with padding", () => {
    const view = fitViewport(1000, 1000, 500, 500);
    // (500 - 48) / 1000 = 0.452 on the tighter axis.
    expect(view.scale).toBeCloseTo(0.452, 3);
    expect(view.x).toBeCloseTo((500 - 1000 * view.scale) / 2, 5);
  });

  it("falls back to 1× for empty content", () => {
    expect(fitViewport(0, 0, 500, 500).scale).toBe(1);
  });
});

describe("zoomViewport", () => {
  it("keeps the pivot point pinned while zooming", () => {
    const before: Viewport = { x: 0, y: 0, scale: 1 };
    const worldUnderPivot = (v: Viewport, p: number) => (p - v.x) / v.scale;
    const after = zoomViewport(before, 2, 100, 100);
    expect(after.scale).toBe(2);
    expect(worldUnderPivot(after, 100)).toBeCloseTo(worldUnderPivot(before, 100), 9);
  });

  it("clamps scale to the allowed range", () => {
    const base: Viewport = { x: 0, y: 0, scale: 1 };
    expect(zoomViewport(base, 1000, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomViewport(base, 0.0001, 0, 0).scale).toBe(MIN_SCALE);
  });
});

describe("panViewport", () => {
  it("translates by the screen delta", () => {
    expect(panViewport({ x: 5, y: 5, scale: 2 }, 10, -3)).toEqual({ x: 15, y: 2, scale: 2 });
  });
});

describe("isLowDetail", () => {
  it("enables low-detail only when zoomed below the threshold", () => {
    expect(isLowDetail(LOD_SCALE - 0.01)).toBe(true);
    expect(isLowDetail(LOD_SCALE)).toBe(false);
    expect(isLowDetail(1)).toBe(false);
  });
});

describe("toTransform", () => {
  it("emits an SVG transform attribute", () => {
    expect(toTransform({ x: 1.5, y: 2.5, scale: 0.5 })).toBe("translate(1.5 2.5) scale(0.5)");
  });
});
