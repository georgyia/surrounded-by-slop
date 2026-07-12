/**
 * Pan/zoom math for the diagram, kept pure so the interaction model is
 * unit-tested rather than eyeballed. `main.ts` owns the pointer/wheel events and
 * applies the resulting transform to the `.slop-viewport` group; every geometric
 * decision lives here.
 */

export interface Viewport {
  /** Screen-space translation of the content origin. */
  readonly x: number;
  readonly y: number;
  /** Uniform scale factor. */
  readonly scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
const FIT_PADDING = 24;
/**
 * Below this scale, leaf labels are too small to read and only add clutter and
 * render cost — drop to a level-of-detail view that keeps the boxes and cluster
 * labels but hides member text (SBS-065).
 */
export const LOD_SCALE = 0.4;

/** Whether the diagram should render in low-detail mode at the given zoom. */
export function isLowDetail(scale: number): boolean {
  return scale < LOD_SCALE;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Center `content` inside `view` at the largest scale that fits (never enlarging
 * past 1×, so a small graph shows at natural size rather than as a few giant boxes).
 */
export function fitViewport(
  contentWidth: number,
  contentHeight: number,
  viewWidth: number,
  viewHeight: number,
): Viewport {
  const availableWidth = Math.max(1, viewWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewHeight - FIT_PADDING * 2);
  const scale =
    contentWidth <= 0 || contentHeight <= 0
      ? 1
      : clampScale(Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight));
  return {
    scale,
    x: (viewWidth - contentWidth * scale) / 2,
    y: (viewHeight - contentHeight * scale) / 2,
  };
}

/** Zoom by `factor`, keeping the content point under (`pivotX`, `pivotY`) fixed on screen. */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  pivotX: number,
  pivotY: number,
): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: pivotX - (pivotX - viewport.x) * ratio,
    y: pivotY - (pivotY - viewport.y) * ratio,
  };
}

/** Translate by a screen-space delta. */
export function panViewport(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
  return { ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY };
}

/** The SVG `transform` string for a viewport (a presentation attribute, not inline CSS). */
export function toTransform(viewport: Viewport): string {
  const round = (value: number): string => String(Math.round(value * 1000) / 1000);
  return `translate(${round(viewport.x)} ${round(viewport.y)}) scale(${round(viewport.scale)})`;
}
