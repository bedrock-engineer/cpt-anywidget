import * as d3 from "./d3";
import type {
  AnySelection,
  Overlay,
  Placer,
  Series,
  VerticalScale,
} from "./types";

// overlays: polylines in (channel x, vertical y) space, e.g. a fitted
// hydrostatic pore-pressure line — each borrows the x scale of the
// series it annotates, so it zooms and clips with the data. An overlay
// whose channel isn't plotted has no x scale and is skipped. Returns
// the placer; call it once with the initial scale and again on zoom
export function overlayLayer(
  svg: AnySelection<SVGSVGElement>,
  overlays: Overlay[],
  { seriesByKey, clipId }: { seriesByKey: Map<string, Series>; clipId: string },
): Placer {
  const overlayPath = (o: Overlay, y1: VerticalScale) => {
    const s = seriesByKey.get(o.channel);
    if (!s) {
      return null;
    }
    return d3
      .line<[number | null, number | null]>()
      .defined((p) => p[0] != null && p[1] != null)
      .x((p) => s.x(p[0]!))
      .y((p) => y1(p[1]!))(o.points ?? []);
  };

  const paths = svg
    .append("g")
    .attr("clip-path", `url(#${clipId})`)
    .selectAll<SVGPathElement, Overlay>("path")
    .data(overlays)
    .join("path")
    .attr("fill", "none")
    .attr("stroke", (o) => o.color ?? "currentColor")
    .attr("stroke-width", (o) => o.width ?? 1.5)
    .attr("stroke-dasharray", (o) => o.dash ?? "6 4");

  return (y1) => paths.attr("d", (o) => overlayPath(o, y1));
}
