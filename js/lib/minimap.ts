import * as d3 from "./d3";
import type { AnySelection } from "./types";

// overview bar for the horizontally scrolling profile: the whole svg
// width compressed into the visible width, one mark per strip footprint,
// and a viewport rectangle mirroring the scroller. Drag the rectangle or
// click the track to navigate. Hidden while the profile fits without
// scrolling, so it only appears when there is somewhere to navigate to

export interface MinimapProps {
  /** strip centers in profile-svg px */
  centers: number[];
  /** the profile svg width the scroller is currently scrolling */
  contentWidth: number;
}

interface MinimapConfig {
  stripWidth: number;
  height?: number;
  signal: AbortSignal;
}

export function minimap(
  host: AnySelection<HTMLDivElement>,
  scroller: HTMLDivElement,
  { stripWidth, height = 20, signal }: MinimapConfig,
): (props: MinimapProps) => void {
  let centers: number[] = [];
  let contentWidth = 1;
  let minimapWidth = 0; // the minimap's own px width, tracking the scroller's

  const svg = host
    .append("svg")
    .attr("height", height)
    .style("display", "block")
    .style("margin-bottom", "4px")
    .style("touch-action", "none");

  const track = svg
    .append("rect")
    .attr("height", height)
    .attr("rx", 3)
    .attr("fill", "currentColor")
    .attr("fill-opacity", 0.06)
    .style("cursor", "pointer");

  const marks = svg
    .append("g")
    .attr("fill", "currentColor")
    .attr("fill-opacity", 0.45);

  const view = svg
    .append("rect")
    .attr("y", 0.75)
    .attr("height", height - 1.5)
    .attr("rx", 3)
    .attr("fill", "currentColor")
    .attr("fill-opacity", 0.12)
    .attr("stroke", "currentColor")
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1.5)
    .style("cursor", "grab");

  const viewGeom = () => ({
    x: (scroller.scrollLeft * minimapWidth) / contentWidth,
    w: (scroller.clientWidth * minimapWidth) / contentWidth,
  });

  const placeView = () => {
    const { x, w } = viewGeom();
    view.attr("x", x).attr("width", w);
  };

  const layout = () => {
    minimapWidth = scroller.clientWidth;

    if (contentWidth > minimapWidth + 1) {
      host.style("display", null);
    } else {
      host.style("display", "none");
    }

    svg.attr("width", minimapWidth);
    track.attr("width", minimapWidth);

    const k = minimapWidth / contentWidth;

    marks
      .selectAll<SVGRectElement, number>("rect")
      .data(centers)
      .join("rect")
      .attr("x", (c) => (c - stripWidth / 2) * k)
      .attr("width", Math.max(1, stripWidth * k))
      .attr("y", 4)
      .attr("height", height - 8);

    placeView();
  };

  scroller.addEventListener("scroll", placeView, { signal });

  const layoutResizeObserver = new ResizeObserver(layout);
  layoutResizeObserver.observe(scroller);
  signal.addEventListener("abort", () => layoutResizeObserver.disconnect());

  view.call(
    d3
      .drag<SVGRectElement, unknown>()
      .on("start", () => {
        d3.select(scroller).interrupt("minimap-scroll");
        view.style("cursor", "grabbing");
      })
      .on("drag", (event: d3.D3DragEvent<SVGRectElement, unknown, unknown>) => {
        scroller.scrollLeft += (event.dx * contentWidth) / minimapWidth;
      })
      .on("end", () => view.style("cursor", "grab")),
  );

  // click-to-center; clicks landing on the viewport rectangle are the
  // drag gesture's business. Not scrollTo({behavior: "smooth"}): its
  // duration grows with distance, so far clicks crawl — tween scrollLeft
  // with a capped duration so every click lands quickly
  svg.on("click", (event: MouseEvent) => {
    const [px] = d3.pointer(event);
    const { x, w } = viewGeom();

    if (px >= x && px <= x + w) {
      return;
    }

    const target =
      (px * contentWidth) / minimapWidth - scroller.clientWidth / 2;
    const from = scroller.scrollLeft;
    d3.select(scroller)
      .transition("minimap-scroll")
      .duration(Math.min(400, 100 + Math.abs(target - from) / 8))
      .tween("scroll", () => (t) => {
        scroller.scrollLeft = from + (target - from) * t;
      });
  });

  return ({ centers: nextCenters, contentWidth: nextWidth }) => {
    centers = nextCenters;
    contentWidth = nextWidth;
    layout();
  };
}
