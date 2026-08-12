import type { Layer } from "./types";

// the four legal transformations of the edited layer stack: one flat
// list whose adjacent entries share a boundary (above.bottom ===
// below.top), in either vertical orientation (depth: top < bottom,
// nap: top > bottom). Every operation is pure — layers in, fresh
// layers out, the input untouched — and returns the input array itself
// when nothing changed, so callers gate re-joins and model syncs on
// reference equality.

// in vertical-coordinate units (m); keeps a layer from collapsing
export const minThickness = 0.05;

// the legal window for a boundary between the extremes a and b,
// orientation-agnostic; inverted (lo > hi) when the span is too thin
const clampWindow = (a: number, b: number): [number, number] => [
  Math.min(a, b) + minThickness,
  Math.max(a, b) - minThickness,
];

/** move the boundary shared by layers[i] and layers[i + 1] to value,
    clamped so neither neighbour drops below minThickness */
export function dragBoundary(layers: Layer[], i: number, value: number): Layer[] {
  const above = layers[i];
  const below = layers[i + 1];
  if (!above || !below) {
    return layers;
  }

  const [lo, hi] = clampWindow(above.top, below.bottom);
  if (lo > hi) {
    return layers; // the pair is too thin for the boundary to move at all
  }

  const v = Math.max(lo, Math.min(hi, value));
  if (v === above.bottom && v === below.top) {
    return layers;
  }

  return layers.map((l, j) => (j === i ? { ...l, bottom: v } : j === i + 1 ? { ...l, top: v } : l));
}

/** split layers[i] at value: two halves sharing the new boundary, both
    keeping the layer's class; value clamps inside the layer, and a
    layer thinner than two minimum thicknesses won't split */
export function splitAt(layers: Layer[], i: number, value: number): Layer[] {
  const d = layers[i];
  if (!d) {
    return layers;
  }

  const [lo, hi] = clampWindow(d.top, d.bottom);
  if (lo > hi) {
    return layers; // too thin to split
  }

  const v = Math.max(lo, Math.min(hi, value));

  return [...layers.slice(0, i), { ...d, bottom: v }, { ...d, top: v }, ...layers.slice(i + 1)];
}

/** the boundary below layers[i] disappears: the upper layer absorbs
    the lower one and keeps its own class */
export function merge(layers: Layer[], i: number): Layer[] {
  const above = layers[i];
  const below = layers[i + 1];
  if (!above || !below) {
    return layers;
  }

  return [...layers.slice(0, i), { ...above, bottom: below.bottom }, ...layers.slice(i + 2)];
}

/** assign a soil class to layers[i], dropping stale denormalized
    color/label: from here on the class drives both */
export function assignClass(layers: Layer[], i: number, className: string): Layer[] {
  const d = layers[i];
  if (!d) {
    return layers;
  }
  if (d.class === className && d.color === undefined && d.label === undefined) {
    return layers;
  }

  const next: Layer = { ...d, class: className };
  delete next.color;
  delete next.label;

  return layers.map((l, j) => (j === i ? next : l));
}
