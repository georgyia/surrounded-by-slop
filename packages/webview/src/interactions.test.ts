// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DiagramSurface, setupInteractions } from "./interactions.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function build(): { root: HTMLElement; node: SVGGElement; rect: SVGRectElement } {
  document.body.replaceChildren();
  const root = document.createElement("div");
  const svg = document.createElementNS(SVG_NS, "svg");
  const viewport = document.createElementNS(SVG_NS, "g");
  viewport.setAttribute("class", "slop-viewport");
  const node = document.createElementNS(SVG_NS, "g") as SVGGElement;
  node.setAttribute("data-node-id", "func:a.ts#alpha");
  const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  node.append(rect);
  viewport.append(node);
  svg.append(viewport);
  root.append(svg);
  document.body.append(root);
  return { root, node, rect };
}

function makeSurface(overrides: Partial<DiagramSurface> = {}): DiagramSurface {
  return {
    isActive: () => true,
    pan: vi.fn(),
    zoom: vi.fn(),
    fit: vi.fn(),
    reveal: vi.fn(),
    ...overrides,
  };
}

function press(target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      bubbles: true,
    }),
  );
}
function release(target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent("pointerup", { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
  );
}
function click(target: Element, x: number, y: number, modifier?: "meta"): void {
  target.dispatchEvent(
    new MouseEvent("click", {
      clientX: x,
      clientY: y,
      metaKey: modifier === "meta",
      bubbles: true,
    }),
  );
}

describe("setupInteractions", () => {
  let dom: ReturnType<typeof build>;
  let surface: DiagramSurface;

  beforeEach(() => {
    dom = build();
    surface = makeSurface();
    setupInteractions(dom.root, surface);
  });

  it("reveals the node under a plain click", () => {
    press(dom.rect, 10, 10);
    release(dom.rect, 10, 10);
    click(dom.rect, 10, 10);
    expect(surface.reveal).toHaveBeenCalledWith("func:a.ts#alpha", false);
  });

  it("does not capture the pointer on a plain press — capturing would swallow the click", () => {
    const capture = vi.spyOn(dom.root, "setPointerCapture");
    press(dom.root, 10, 10);
    expect(capture).not.toHaveBeenCalled();
    // …but a real drag does capture, once the pointer has travelled.
    dom.root.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 60, clientY: 60, pointerId: 1, bubbles: true }),
    );
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("treats a press-drag-release as a pan, not a node click", () => {
    press(dom.root, 10, 10);
    dom.root.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 60, clientY: 60, pointerId: 1, bubbles: true }),
    );
    release(dom.root, 60, 60);
    click(dom.rect, 60, 60); // the trailing click after a drag
    expect(surface.pan).toHaveBeenCalled();
    expect(surface.reveal).not.toHaveBeenCalled();
  });

  it("opens to the side on ctrl/cmd click", () => {
    press(dom.rect, 10, 10);
    click(dom.rect, 10, 10, "meta");
    expect(surface.reveal).toHaveBeenCalledWith("func:a.ts#alpha", true);
  });

  it("reveals on Enter over a focused node", () => {
    dom.node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(surface.reveal).toHaveBeenCalledWith("func:a.ts#alpha", false);
  });

  it("ignores clicks on empty canvas", () => {
    press(dom.root, 5, 5);
    click(dom.root, 5, 5);
    expect(surface.reveal).not.toHaveBeenCalled();
  });

  it("zooms on wheel and re-fits on double click", () => {
    dom.root.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 5,
        clientY: 5,
        bubbles: true,
        cancelable: true,
      }),
    );
    dom.root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(surface.zoom).toHaveBeenCalled();
    expect(surface.fit).toHaveBeenCalled();
  });

  it("ignores gestures until a diagram is active", () => {
    const idle = makeSurface({ isActive: () => false });
    const other = build();
    setupInteractions(other.root, idle);
    press(other.rect, 10, 10);
    click(other.rect, 10, 10);
    // isActive gates the press; with no press recorded the click can't resolve a node click either.
    expect(idle.reveal).not.toHaveBeenCalled();
  });
});
