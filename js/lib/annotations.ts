import type { Annotation, AnySelection, Placer } from "./types";

interface AnnotationConfig {
  clipId: string;
  marginLeft: number;
  marginRight: number;
  /** a getter keeps the lines and labels tracking a host that
      resizes (the profile's spacing toggle changes the svg width) */
  width: number | (() => number);
}

// horizontal reference lines with labels, e.g. groundwater level:
// {at, label, color?, dash?, position?: left|center|right, offset?: [dx, dy]}
// — "at" is a value in the current vertical coordinate. Returns the
// placer; call it once with the initial scale and again on every zoom
export function annotationLayer(
  svg: AnySelection<SVGSVGElement>,
  annotations: Annotation[],
  { clipId, marginLeft, marginRight, width }: AnnotationConfig,
): Placer {
  const currentWidth = typeof width === "function" ? width : () => width;

  const labelAnchor = { left: "start", center: "middle", right: "end" };

  const annotation = svg
    .append("g")
    .attr("clip-path", `url(#${clipId})`)
    .selectAll<SVGGElement, Annotation>("g")
    .data(annotations)
    .join("g");

  const line = annotation
    .append("line")
    .attr("x1", marginLeft)
    .attr("stroke", (d) => d.color ?? "currentColor")
    .attr("stroke-dasharray", (d) => d.dash ?? "4 3");

  const label = annotation
    .append("text")
    .attr("y", (d) => -4 + (d.offset?.[1] ?? 0))
    .attr("text-anchor", (d) => labelAnchor[d.position ?? "right"])
    .attr("font-size", 11)
    .attr("fill", (d) => d.color ?? "currentColor")
    .attr("stroke", "white")
    .attr("stroke-width", 1.5)
    .attr("paint-order", "stroke")
    .text((d) => d.label ?? "");

  // the width-dependent attrs are re-applied on every placement, so
  // re-placing after a resize is enough to catch the lines up
  return (y1) => {
    const w = currentWidth();
    // named label slots along the line; offset fine-tunes in pixels
    const labelX = {
      left: marginLeft + 6,
      center: (marginLeft + w - marginRight) / 2,
      right: w - marginRight - 6,
    };
    line.attr("x2", w - marginRight);
    label.attr(
      "x",
      (d) => labelX[d.position ?? "right"] + (d.offset?.[0] ?? 0),
    );
    annotation.attr("transform", (d) => `translate(0,${y1(d.at)})`);
  };
}
