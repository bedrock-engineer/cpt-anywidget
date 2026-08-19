import * as d3 from "./d3";
import type { AnySelection, VerticalScale } from "./types";

// the shared plot frame: every viewer hangs its content on a zoomable
// vertical scale with a left axis, an optional gridline layer, an axis
// title in the top-left corner, and clip regions for the zooming parts.
// These factories close over the frame geometry so the per-viewer render
// functions only state what differs

/** vertical scale over [fallback] unless explicit [limits] override it */
export function makeVerticalScale(
  fallback: [number, number],
  range: [number, number],
  limits?: [number, number],
): VerticalScale {
  const y = d3
    .scaleLinear()
    .domain(limits ?? fallback)
    .range(range);

  // explicit limits are honored exactly; the data-driven fallback is niced
  if (!limits) {
    y.nice();
  }

  return y;
}

/** left vertical axis; re-call with the zoomed scale to redraw */
export const yAxisFor =
  (marginLeft: number, height: number) =>
  (g: AnySelection<SVGGElement>, y1: VerticalScale) =>
    g
      .attr("transform", `translate(${marginLeft},0)`)
      .call(d3.axisLeft(y1).ticks(height / 60));

/** right vertical axis at [x]; re-call with the zoomed scale to redraw.
    x takes a thunk, read per call, when the width can change after
    setup (the profile's spacing toggle) */
export const yAxisRightFor =
  (x: number | (() => number), height: number) =>
  (g: AnySelection<SVGGElement>, y1: VerticalScale) =>
    g
      .attr("transform", `translate(${typeof x === "function" ? x() : x},0)`)
      .call(d3.axisRight(y1).ticks(height / 60));

interface YGridFor {
  x1: number;
  x2: number | (() => number);
  height: number;
}

/** horizontal gridlines spanning [x1, x2] at the vertical axis ticks;
    x2 takes a thunk, read per call, when the width can change after
    setup (the profile's spacing toggle) */
export const yGridFor =
  ({ x1, x2, height }: YGridFor) =>
  (g: AnySelection<SVGGElement>, y1: VerticalScale) =>
    g
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.1)
      .selectAll("line")
      .data(y1.ticks(height / 60))
      .join("line")
      .attr("x1", x1)
      .attr("x2", typeof x2 === "function" ? x2() : x2)
      .attr("y1", (d) => 0.5 + y1(d))
      .attr("y2", (d) => 0.5 + y1(d));

/** vertical-axis title, top-left; outside yAxis so zoom redraws don't
    duplicate it */
export function verticalAxisTitle(
  svg: AnySelection<SVGSVGElement>,
  label: string,
): void {
  svg
    .append("text")
    .attr("x", 0)
    .attr("y", 14)
    .attr("fill", "currentColor")
    .attr("text-anchor", "start")
    .attr("font-weight", "bold")
    .text(label);
}

interface PlotClipPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** rect clipPath with an id unique per widget instance — two widgets on
    one page must not share ids. Returns the id for url(#...) references */
export function plotClip(
  svg: AnySelection<SVGSVGElement>,
  prefix: string,
  { x, y, width, height }: PlotClipPosition,
): string {
  const id = `${prefix}-${crypto.randomUUID()}`;
  
  svg
    .append("clipPath")
    .attr("id", id)
    .append("rect")
    .attr("x", x)
    .attr("y", y)
    .attr("width", width)
    .attr("height", height);

  return id;
}
