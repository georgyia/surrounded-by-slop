import type { NodeKind } from "@surrounded-by-slop/core";
import { describe, expect, it } from "vitest";
import { edgeLegend, nodeLegend } from "./legend.js";
import { paletteFor } from "./render.js";

const light = paletteFor("light");

describe("nodeLegend", () => {
  it("lists only the kinds present, in a stable order", () => {
    const kinds: NodeKind[] = ["function", "class", "module"];
    const entries = nodeLegend(kinds, light);
    expect(entries.map((entry) => entry.label)).toEqual(["Module", "Class", "Function"]);
  });

  it("uses the same fill the renderer draws for that kind", () => {
    const [fn] = nodeLegend(["function"], light);
    expect(fn?.fill).toBe(light.kinds.function.fill);
    expect(fn?.stroke).toBe(light.kinds.function.stroke);
  });

  it("dedupes and drops absent kinds", () => {
    expect(nodeLegend(["class", "class"], light).map((entry) => entry.label)).toEqual(["Class"]);
    expect(nodeLegend([], light)).toEqual([]);
  });
});

describe("edgeLegend", () => {
  it("explains the four line styles, dashing imports and low-confidence", () => {
    const entries = edgeLegend(light);
    expect(entries.map((entry) => entry.label)).toEqual([
      "calls",
      "imports",
      "extends / implements",
      "inferred (low confidence)",
    ]);
    const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
    expect(byLabel.get("imports")?.dashed).toBe(true);
    expect(byLabel.get("calls")?.dashed).toBeUndefined();
    expect(byLabel.get("extends / implements")?.stroke).toBe(light.heritage);
  });
});
