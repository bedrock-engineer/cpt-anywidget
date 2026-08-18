import { axisSlot, buildSeries, channelAxis, channelTitle, lineFor } from "./channels";
import { makeVerticalScale, plotClip, verticalAxisTitle, yAxisFor, yGridFor } from "./frame";
import type {
  AnySelection,
  AxisLimits,
  ChannelSpec,
  CptData,
  Placer,
  Samples,
  Series,
  VerticalScale,
} from "./types";
import type { ResolvedVertical } from "./vertical";

// the CPT chart core: measurement curves against the shared zoomable
// vertical axis — resolved series, the x axes stacked outward from the
// plot edge, both gridline layers, the left vertical axis with its
// title, and the curve paths. Draws once into the given svg; everything
// downstream features hang onto (scale, margins, clip, series) is
// returned, and place() redraws the chart's own parts against a zoomed
// scale so the caller can compose it with its own placers

export interface CptChart {
  /** resolved, plottable channels in axis stacking order */
  series: Series[];
  seriesByKey: Map<string, Series>;
  /** the unzoomed vertical scale */
  y: VerticalScale;
  /** clip id for anything else drawn in plot space */
  clipId: string;
  /** vertical margins grown by the stacked x-axis slots */
  marginTop: number;
  marginBottom: number;
  /** redraw the y axis, gridlines and curves against a (zoomed) scale */
  place: Placer;
}

interface CptChartProps {
  cptData: CptData;
  /** the vertical coordinate column, in render order */
  vertical: Samples;
  vert: ResolvedVertical;
  channels: (string | ChannelSpec)[];
  axisLimits: AxisLimits;
  width: number;
  height: number;
  margin: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  /** right edge of the horizontal gridlines — the widget extends them
      across its layer columns; defaults to the plot edge */
  gridRight?: number;
}

export function cptChart(
  svg: AnySelection<SVGSVGElement>,
  {
    cptData,
    vertical,
    vert,
    channels,
    axisLimits,
    width,
    height,
    margin,
    gridRight,
  }: CptChartProps,
): CptChart {
  // bottom cpt axes read left-to-right, top axes right-to-left (mirrored),
  // so the two dominant curves (qc and Rf) sit back-to-back
  const series = buildSeries({
    channels,
    cptData,
    axisLimits,
    rangeBottom: [margin.left, width - margin.right],
    rangeTop: [width - margin.right, margin.left],
  });

  // one slot per x-axis, stacked outward from the plot edge
  const bottomSeries = series.filter((s) => s.side === "bottom");
  const topSeries = series.filter((s) => s.side === "top");
  const marginTop = margin.top + axisSlot * topSeries.length;
  const marginBottom = margin.bottom + axisSlot * bottomSeries.length;

  const y = makeVerticalScale(
    [vertical[0]!, vertical[vertical.length - 1]!],
    [marginTop, height - marginBottom],
    axisLimits[vert.key],
  );

  const xAxis = (g: AnySelection<SVGGElement>, s: Series, slotY: number) =>
    g
      .attr("transform", `translate(0,${slotY})`)
      .call(channelAxis, s, { ticks: width / 100 })
      .call((g) =>
        g
          .append("text")
          .attr("x", s.side === "bottom" ? margin.left - 16 : width - margin.right + 16)
          // on the tick-number row, not the axis line — the innermost
          // axis line coincides with the plot edge where the outermost
          // y-axis tick label sits
          .attr("y", s.side === "bottom" ? 9 : -9)
          .attr("dy", s.side === "bottom" ? "0.71em" : "0em")
          .attr("fill", s.color)
          .attr("text-anchor", s.side === "bottom" ? "end" : "start")
          .attr("font-weight", "bold")
          .attr("font-size", 12)
          .text(channelTitle(s)),
      );

  // vertical gridlines follow the innermost bottom axis (qc by default)
  const gridXScale = bottomSeries[0]?.x ?? topSeries[0]?.x;

  const xGrid = (g: AnySelection<SVGGElement>) =>
    g
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.1)
      .selectAll("line")
      .data(gridXScale ? gridXScale.ticks(width / 100) : [])
      .join("line")
      .attr("x1", (d) => 0.5 + gridXScale(d))
      .attr("x2", (d) => 0.5 + gridXScale(d))
      .attr("y1", marginTop)
      .attr("y2", height - marginBottom);

  const yAxis = yAxisFor(margin.left, height);

  const yGrid = yGridFor({
    x1: margin.left,
    x2: gridRight ?? width - margin.right,
    height,
  });

  const clipId = plotClip(svg, "plot-clip", {
    x: margin.left,
    y: marginTop,
    width: width - margin.left - margin.right,
    height: height - marginTop - marginBottom,
  });

  const gGrid = svg.append("g").call(yGrid, y);

  svg.append("g").call(xGrid);

  bottomSeries.forEach((s, i) =>
    svg.append("g").call(xAxis, s, height - marginBottom + axisSlot * i),
  );

  topSeries.forEach((s, i) => svg.append("g").call(xAxis, s, marginTop - axisSlot * i));

  const gy = svg.append("g").call(yAxis, y);

  verticalAxisTitle(svg, vert.label);

  const seriesPaths = svg
    .append("g")
    .selectAll<SVGPathElement, Series>("path")
    .data(series, (s) => s.key)
    .join("path")
    .attr("clip-path", `url(#${clipId})`)
    .attr("fill", "none")
    .attr("stroke", (s) => s.color)
    .attr("stroke-width", 1)
    .attr("d", (s) => lineFor(s, vertical, y));

  const place: Placer = (y1) => {
    gy.call(yAxis, y1);
    gGrid.call(yGrid, y1);
    seriesPaths.attr("d", (s) => lineFor(s, vertical, y1));
  };

  return {
    series,
    seriesByKey: new Map(series.map((s) => [s.key, s])),
    y,
    clipId,
    marginTop,
    marginBottom,
    place,
  };
}
