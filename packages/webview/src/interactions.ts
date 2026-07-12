/**
 * Pointer/keyboard wiring for the diagram surface, split out from `main.ts` so
 * the gesture logic can be unit-tested in a DOM (it can't run under the webview
 * otherwise). The viewport state and rendering stay in `main.ts` behind the
 * `DiagramSurface` callbacks; this module only decides *what* a gesture means.
 */

export interface DiagramSurface {
  /** True once a diagram is rendered — gestures are ignored before then. */
  isActive(): boolean;
  pan(deltaX: number, deltaY: number): void;
  zoom(factor: number, pivotX: number, pivotY: number): void;
  /** Re-fit the whole diagram to the viewport. */
  fit(): void;
  /** A node was activated by click or keyboard. */
  reveal(nodeId: string, toSide: boolean): void;
}

/** How far the pointer may travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

function nodeIdAt(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null)
    : null;
}

export function setupInteractions(root: HTMLElement, surface: DiagramSurface): void {
  root.addEventListener(
    "wheel",
    (event) => {
      if (!surface.isActive()) {
        return;
      }
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      surface.zoom(factor, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  let downX = 0;
  let downY = 0;
  let pointerDown = false;
  let dragging = false;

  root.addEventListener("pointerdown", (event) => {
    if (!surface.isActive() || event.button !== 0) {
      return;
    }
    pointerDown = true;
    dragging = false;
    downX = event.clientX;
    downY = event.clientY;
    // Capture is deferred to the first real move (below): capturing here would
    // retarget the click to `root` and swallow node clicks.
  });

  root.addEventListener("pointermove", (event) => {
    if (!pointerDown) {
      return;
    }
    if (!dragging && Math.hypot(event.clientX - downX, event.clientY - downY) > DRAG_THRESHOLD) {
      dragging = true;
      root.classList.add("slop-dragging");
      root.setPointerCapture(event.pointerId);
    }
    if (dragging) {
      surface.pan(event.movementX, event.movementY);
    }
  });

  const endDrag = (event: PointerEvent): void => {
    pointerDown = false;
    if (dragging) {
      dragging = false;
      root.classList.remove("slop-dragging");
      if (root.hasPointerCapture(event.pointerId)) {
        root.releasePointerCapture(event.pointerId);
      }
    }
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  // Double-click empty space to re-fit the whole diagram.
  root.addEventListener("dblclick", () => surface.fit());

  // A click that didn't travel (i.e. wasn't a pan) jumps to the node's source.
  root.addEventListener("click", (event) => {
    const nodeId = nodeIdAt(event.target);
    if (
      nodeId === null ||
      Math.hypot(event.clientX - downX, event.clientY - downY) > DRAG_THRESHOLD
    ) {
      return;
    }
    surface.reveal(nodeId, event.ctrlKey || event.metaKey);
  });

  // Keyboard: Enter/Space on a focused node does the same.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const nodeId = nodeIdAt(event.target);
    if (nodeId === null) {
      return;
    }
    event.preventDefault();
    surface.reveal(nodeId, event.ctrlKey || event.metaKey);
  });
}
