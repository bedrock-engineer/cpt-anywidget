import * as d3 from "./d3";
import type { AnySelection, ProfileOverlay, VerticalScale } from "./types";

// profile-space overlays (groundwater level, surface line, ...) span
// the strips in (chainage, vertical) coordinates. Builds the joins once
// and returns a placer taking the current vertical scale plus the live
// strip geometry — centers/distX change when the spacing toggle flips,
// so they're per-call arguments; pass the optional transition to
// animate a spacing change

export function profileOverlayLayer(
  svg: AnySelection<SVGSVGElement>,
  overlays: ProfileOverlay[],
  {
    names,
    stripWidth,
    clipId,
  }: {
    /** strip names in chainage order, indexing the centers array */
    names: string[];
    stripWidth: number;
    clipId: string;
  },
) {
  const overlayG = svg
    .append("g")
    .attr("clip-path", `url(#${clipId})`)
    .selectAll<SVGGElement, ProfileOverlay>("g")
    .data(overlays)
    .join("g");

  const overlayPath = overlayG
    .append("path")
    .attr("fill", "none")
    .attr("stroke", (o) => o.color ?? "currentColor")
    .attr("stroke-dasharray", (o) => o.dash ?? null)
    .attr("stroke-width", (o) => o.width ?? 1.5);

  const overlayLabel = overlayG
    .append("text")
    .attr("font-size", 11)
    .attr("fill", (o) => o.color ?? "currentColor")
    .attr("stroke", "white")
    .attr("stroke-width", 1.75)
    .attr("paint-order", "stroke")
    .text((o) => o.label ?? "");

  return (
    y1: VerticalScale,
    { centers, distX }: { centers: number[]; distX: (d: number) => number },
    // any-typed for the same reason as AnySelection: the d3 transition
    // generics fail variance checks at every seam
    t?: d3.Transition<any, any, any, any>,
  ) => {
    // the overlay's first drawable vertex, anchoring its label
    const firstVertex = (o: ProfileOverlay): [number, number] | null => {
      if (o.levels) {
        const i = names.findIndex((name) => o.levels![name] != null);
        return i < 0
          ? null
          : [centers[i] - stripWidth / 2, o.levels[names[i]]!];
      }
      const p = (o.points ?? []).find((p) => p[0] != null && p[1] != null);
      return p ? [distX(p[0]!), p[1]!] : null;
    };

    const overlayLine = (o: ProfileOverlay) => {
      // per-strip levels: flat across each strip's width, consecutive
      // strips joined by a sloping connector. An absent name bridges to
      // the next strip with a value (e.g. a GWL line skipping non-CPTU
      // soundings); an explicit null breaks the line
      if (o.levels) {
        let d = "";
        let connected = false;
        names.forEach((name, i) => {
          const v = o.levels![name];
          if (v == null) {
            if (v === null) {
              connected = false;
            }
            return;
          }
          const left = centers[i] - stripWidth / 2;
          d += `${connected ? "L" : "M"}${left},${y1(v)}H${left + stripWidth}`;
          connected = true;
        });
        return d || null;
      }

      return d3
        .line<[number | null, number | null]>()
        .defined((p) => p[0] != null && p[1] != null)
        .x((p) => distX(p[0]!))
        .y((p) => y1(p[1]!))(o.points ?? []);
    };

    const labelX = (o: ProfileOverlay) => {
      const p = firstVertex(o);
      return p ? p[0] + 4 : 0;
    };

    const labelY = (o: ProfileOverlay) => {
      const p = firstVertex(o);
      return p ? y1(p[1]) - 5 : 0;
    };

    if (t) {
      overlayPath.transition(t).attr("d", overlayLine);
      overlayLabel.transition(t).attr("x", labelX).attr("y", labelY);
    } else {
      overlayPath.attr("d", overlayLine);
      overlayLabel
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("display", (o) => (firstVertex(o) ? null : "none"));
    }
  };
}
