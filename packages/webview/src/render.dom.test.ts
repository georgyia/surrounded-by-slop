// @vitest-environment happy-dom
import { analyzeTypeScriptProject, layoutGraph } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { renderDiagram } from "./render.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function parse(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  expect(root.nodeName.toLowerCase()).toBe("svg");
  return root;
}

/** Distance from a point to the nearest edge of a rectangle (0 if inside). */
function distanceToBox(
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

describe("renderDiagram — DOM geometry", () => {
  it("parses to well-formed SVG with one viewport and no parser errors", async () => {
    const { graph } = analyzeTypeScriptProject([
      { path: "a.ts", text: "function a() { b(); }\nfunction b() {}\n" },
    ]);
    const svg = renderDiagram(graph, await layoutGraph(graph), "light");
    const root = parse(svg);
    expect(root.getElementsByTagName("parsererror").length).toBe(0);
    expect(root.getElementsByClassName("slop-viewport").length).toBe(1);
  });

  it("lands every arrow within a few pixels of the box it points at", async () => {
    // Members that call each other inside a class container — the case the LCA
    // offset fix targets. Each polyline's final point must reach its target box.
    const { graph } = analyzeTypeScriptProject([
      {
        path: "svc.ts",
        text: "export class S {\n  place() { return this.step(); }\n  step() { return 1; }\n}\n",
      },
    ]);
    const layout = await layoutGraph(graph);
    const svg = renderDiagram(graph, layout, "light");
    const root = parse(svg);

    const leaves = layout.nodes.filter((node) => !node.container);
    const polylines = Array.from(root.getElementsByTagNameNS(SVG_NS, "polyline"));
    expect(polylines.length).toBeGreaterThan(0);

    for (const polyline of polylines) {
      const points = (polyline.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [x, y] = pair.split(",").map(Number);
          return { x: x ?? 0, y: y ?? 0 };
        });
      expect(points.length).toBeGreaterThanOrEqual(2);
      const tip = points[points.length - 1];
      if (tip === undefined) {
        continue;
      }
      // The arrow tip sits on the boundary of *some* leaf box (its target).
      const nearest = Math.min(...leaves.map((leaf) => distanceToBox(tip, leaf)));
      expect(nearest).toBeLessThan(4);
    }
  });
});
