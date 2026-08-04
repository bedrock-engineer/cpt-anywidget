import * as d3 from "./d3";
import type { AnySelection, Samples, Series, VerticalScale } from "./types";

// crosshair at the hovered elevation: a rule across the plot, the
// vertical value on the axis, and a dot + readout per series — all in
// one group translated vertically to the hovered sample. currentY()
// returns the live (zoomed) scale so the hit test follows the zoom
export function crosshair(
  svg: AnySelection<SVGSVGElement>,
  {
    series,
    vertical,
    formatVertical,
    marginLeft,
    marginRight,
    width,
    currentY,
  }: {
    series: Series[];
    vertical: Samples;
    /** formats the vertical readout; comes from the resolved vertical
        spec, e.g. signed for NAP so values near the datum read
        unambiguously */
    formatVertical: (v: number) => string;
    marginLeft: number;
    marginRight: number;
    width: number;
    currentY: () => VerticalScale;
  },
): void {
  const formatValue = d3.format(".2f");

  const focus = svg.append("g").attr("display", "none");

  focus
    .append("line")
    .attr("x1", marginLeft)
    .attr("x2", width - marginRight)
    .attr("stroke", "currentColor")
    .attr("stroke-opacity", 0.3);

  const verticalReadout = focus
    .append("text")
    .attr("x", marginLeft - 8)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .attr("font-size", 12)
    .attr("font-weight", "bold")
    .attr("fill", "currentColor")
    .attr("stroke", "white")
    .attr("stroke-width", 4)
    .attr("paint-order", "stroke");

  const dots = focus
    .selectAll<SVGCircleElement, Series>("circle")
    .data(series)
    .join("circle")
    .attr("r", 2.5)
    .attr("fill", (s) => s.color);

  const readouts = focus
    .selectAll<SVGTextElement, Series>("text.readout")
    .data(series)
    .join("text")
    .attr("class", "readout")
    .attr("x", width - marginRight)
    .attr("y", (_, i) => (i - (series.length - 1) / 2) * 14)
    .attr("dy", "0.32em")
    .attr("text-anchor", "start")
    .attr("font-size", 12)
    .attr("fill", (s) => s.color)
    .attr("stroke", "white")
    .attr("stroke-width", 4)
    .attr("paint-order", "stroke");

  const bisectorDescend = d3.bisector<number, number>((d, x) => x - d);

  // bisect matching the data direction: depth ascends, nap descends
  const bisectVertical =
    vertical[0]! <= vertical[vertical.length - 1]!
      ? (value: number) => d3.bisectCenter(vertical as number[], value)
      : (value: number) => bisectorDescend.center(vertical as number[], value);

  function pointermoved(event: PointerEvent) {
    const zy = currentY();
    const [, ym] = d3.pointer(event);
    const i = bisectVertical(zy.invert(ym));

    if (vertical[i] == null) {
      focus.attr("display", "none");
      return;
    }

    focus
      .attr("display", null)
      .attr("transform", `translate(0,${zy(vertical[i]!)})`);

    verticalReadout.text(`${formatVertical(vertical[i]!)} m`);

    dots
      .attr("display", (s) => (s.values[i] == null ? "none" : null))
      .attr("cx", (s) => (s.values[i] == null ? 0 : s.x(s.values[i]!)));

    readouts.text((s) =>
      s.values[i] == null ? "" : `${s.label} ${formatValue(s.values[i]!)}`,
    );
  }

  svg
    .on("pointerenter pointermove", pointermoved)
    .on("pointerleave", () => focus.attr("display", "none"));
}
