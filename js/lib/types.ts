import type { ScaleLinear } from "d3-scale";
import type { Selection } from "d3-selection";

// the JSON shapes shared between the Python traits and the front end —
// this file is the TS mirror of the trait docstrings in cpt_viewer.py /
// bhrgt_viewer.py; change them together

/** one column of samples; None from Python arrives as null */
export type Samples = (number | null)[];

/** {"nap": [...], "coneResistance": [...], ...} — equal-length columns */
export type CptData = Record<string, Samples>;

/** per-channel [min, max] axis overrides, keyed like CptData */
export type AxisLimits = Record<string, [number, number]>;

/** soil-composition band, x proportional in [0, 1] across the fill area */
export interface Band {
  x1: number;
  x2: number;
  color: string;
  hatch?: string;
}

/** one soil layer; top/bottom in the current vertical coordinate */
export interface Layer {
  top: number;
  bottom: number;
  label?: string;
  color?: string;
  /** references a SoilClass by name; drives fill + label when set */
  class?: string;
  bands?: Band[];
}

/** read-only interpretation column stacked next to the plot */
export interface Interpretation {
  label?: string;
  layers?: Layer[];
}

/** nearby geotechnical borehole; {} hides the column */
export interface Borehole {
  label?: string;
  layers?: Layer[];
}

/** horizontal reference line, e.g. groundwater level */
export interface Annotation {
  at: number;
  label?: string;
  color?: string;
  dash?: string;
  position?: "left" | "center" | "right";
  offset?: [number, number];
}

/** polyline in (channel x, vertical y) space */
export interface Overlay {
  channel: string;
  points?: [number | null, number | null][];
  color?: string;
  dash?: string;
  width?: number;
}

/** soil-class palette entry, the single source of truth for layer colors */
export interface SoilClass {
  name: string;
  color: string;
  label?: string;
}

/** vertical-coordinate binding: a CptData key plus display overrides;
    "depth" and "nap" carry defaults, see lib/vertical.ts */
export interface VerticalSpec {
  key: string;
  /** full axis title, e.g. "NAP [m]" */
  label?: string;
  /** positive up (elevation) vs positive down (depth); only the
      fallback when the data order can't tell the render direction */
  up?: boolean;
  /** d3 format for readouts, e.g. "+.2f" */
  format?: string;
}

/** channel binding: a CptData key plus display overrides */
export interface ChannelSpec {
  key: string;
  label?: string;
  unit?: string;
  color?: string;
  side?: "bottom" | "top";
}

/** a resolved, plottable channel: spec merged with defaults + data */
export interface Series {
  key: string;
  label: string;
  unit?: string;
  color: string;
  side: "bottom" | "top";
  x: ScaleLinear<number, number>;
  values: Samples;
  /** the rendered path, attached by the widget entry */
  path?: Selection<SVGPathElement, unknown, null, undefined>;
}

/** the vertical scale, possibly rescaled by the current zoom */
export type VerticalScale = ScaleLinear<number, number>;

/** re-place a component against a (zoomed) vertical scale — the module
    contract: a component builds its nodes once and returns one of these
    for the zoom loop to drive */
export type Placer = (y1: VerticalScale) => void;

/** any d3 selection where we don't care about the datum chain — the
    d3 generics are not worth threading through every seam */
export type AnySelection<E extends Element = Element> = Selection<
  E,
  any,
  any,
  any
>;
