import type { Annotation, AnySelection, Placer } from "./types";

// horizontal reference lines with labels, e.g. groundwater level:
// {at, label, color?, dash?, position?: left|center|right, offset?: [dx, dy]}
// — "at" is a value in the current vertical coordinate. Returns the
// placer; call it once with the initial scale and again on every zoom
export function annotationLayer(
  svg: AnySelection<SVGSVGElement>,
  annotations: Annotation[],
  {
    clipId,
    marginLeft,
    marginRight,
    width,
  }: { clipId: string; marginLeft: number; marginRight: number; width: number },
): Placer {
  // named label slots along the line; offset fine-tunes in pixels
  const labelX = {
    left: marginLeft + 6,
    center: (marginLeft + width - marginRight) / 2,
    right: width - marginRight - 6,
  };

  const labelAnchor = { left: "start", center: "middle", right: "end" };

  const annotation = svg
    .append("g")
    .attr("clip-path", `url(#${clipId})`)
    .selectAll<SVGGElement, Annotation>("g")
    .data(annotations)
    .join("g");

  annotation
    .append("line")
    .attr("x1", marginLeft)
    .attr("x2", width - marginRight)
    .attr("stroke", (d) => d.color ?? "currentColor")
    .attr("stroke-dasharray", (d) => d.dash ?? "4 3");

  annotation
    .append("text")
    .attr("x", (d) => labelX[d.position ?? "right"] + (d.offset?.[0] ?? 0))
    .attr("y", (d) => -4 + (d.offset?.[1] ?? 0))
    .attr("text-anchor", (d) => labelAnchor[d.position ?? "right"])
    .attr("font-size", 11)
    .attr("fill", (d) => d.color ?? "currentColor")
    .attr("stroke", "white")
    .attr("stroke-width", 2)
    .attr("paint-order", "stroke")
    .text((d) => d.label ?? "");

  return (y1) => annotation.attr("transform", (d) => `translate(0,${y1(d.at)})`);
}
