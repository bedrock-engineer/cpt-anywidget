import type { Layer, VerticalScale } from "./types";

// the structure lane's decision rule, pure: what edit does the lane
// offer at a pixel? The hover preview and the click commit both call
// this, so they can't disagree. layer-edits.ts owns whether the edit
// is legal; this only names the target.

/** pointer-to-boundary distance in px that reads as "this boundary" */
export const snapPx = 6;

// at: the preview's pixel anchor — the boundary for a merge, the
// pointer for a split
export type LaneTarget =
  | { kind: "merge"; boundary: number; at: number }
  | { kind: "split"; layer: number; value: number; at: number }
  | null;

/** what the lane offers at pixel py: the nearest internal boundary
    within snap px reads as a merge, else the containing layer and the
    inverted depth read as a split, else nothing (outside the stack) */
export function laneTarget(
  layers: Layer[],
  y1: VerticalScale,
  py: number,
  snap = snapPx,
): LaneTarget {
  let best = snap;
  let nearest: LaneTarget = null;
  for (let i = 0; i < layers.length - 1; i++) {
    const by = y1(layers[i].bottom);
    if (Math.abs(by - py) < best) {
      best = Math.abs(by - py);
      nearest = { kind: "merge", boundary: i, at: by };
    }
  }
  if (nearest) {
    return nearest;
  }

  const value = y1.invert(py);
  // orientation-agnostic containment (depth: top < bottom, nap: reverse)
  const layer = layers.findIndex((l) => (value - l.top) * (value - l.bottom) <= 0);

  return layer === -1 ? null : { kind: "split", layer, value, at: py };
}
