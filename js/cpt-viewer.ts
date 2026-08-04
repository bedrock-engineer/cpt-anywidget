import type { AnyModel, RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { hatchDefs } from "./lib/hatch";
import { buildSeries, lineFor } from "./lib/channels";
import { layerRenderer, placeLayerColumn } from "./lib/layers";
import { annotationLayer } from "./lib/annotations";
import { overlayLayer } from "./lib/overlays";
import { crosshair } from "./lib/crosshair";
import {
  makeVerticalScale,
  plotClip,
  verticalAxisTitle,
  yAxisFor,
  yGridFor,
} from "./lib/frame";
import { resolveVertical } from "./lib/vertical";
import { verticalZoom } from "./lib/zoom";
import { editableColumn } from "./lib/editing";
import type {
  Annotation,
  AnySelection,
  AxisLimits,
  Borehole,
  ChannelSpec,
  CptData,
  Interpretation,
  Layer,
  Overlay,
  Series,
  SoilClass,
  VerticalSpec,
} from "./lib/types";

/** the synced traits — the TS mirror of CPTViewer's traitlets */
interface CptModel {
  cptData: CptData;
  verticalKey: string | VerticalSpec;
  axisLimits: AxisLimits;
  annotations: Annotation[];
  overlays: Overlay[];
  channels: (string | ChannelSpec)[];
  interpretations: Interpretation[];
  borehole: Borehole;
  editedLayers: Layer[];
  soil_classes: SoilClass[];
  width: number;
  height: number;
}

/** one layer column in the slot layout left/right of the plot */
interface ColumnSpec {
  label: string;
  layers: Layer[];
  side?: "left";
  editable?: boolean;
  gapBefore?: boolean;
  x?: number;
}

export default {
  /** @param context the model shared by every view of this widget */
  initialize({ model, signal }: { model: AnyModel<CptModel>; signal: AbortSignal }) {
    // Set up shared state, event handlers, or programmatic exports.
    // Use `signal` (AbortSignal) for cleanup when the widget is destroyed.
  },
  render({
    model,
    el,
    signal,
  }: RenderProps<CptModel> & { signal: AbortSignal }) {
    const cptData = model.get("cptData");

    // which cptData column is the vertical coordinate: a key string or a
    // {key, label?, up?, format?} spec merged over the display defaults
    // for "depth" and "nap". The contract is that the first sample
    // renders at the top — the Python facade sorts rows into that order
    // (data passed raw via cptData= must arrive sorted)
    const vert = resolveVertical(model.get("verticalKey"), "depth");
    const vertical = cptData[vert.key] ?? [];

    // optional per-channel [min, max] overrides, keyed like cptData
    // (plus "depth" for the shared depth axis)
    const axisLimits = model.get("axisLimits") ?? {};

    /** horizontal reference lines with labels, e.g. groundwater level */
    const annotations = model.get("annotations") ?? [];

    // which channels to plot, in stacking order — key strings or specs,
    // resolved against the built-in defaults in buildSeries so unknown
    // keys add new plottable channels; empty = all default channels
    const channels = model.get("channels") ?? [];

    // read-only interpretation columns, stacked right of the plot
    const interpretations = model.get("interpretations") ?? [];

    // nearby geotechnical borehole, left of the plot on the shared axis;
    // {} hides the column
    const borehole = model.get("borehole") ?? {};
    const boreholeLayers = borehole.layers ?? [];

    // soil-class palette [{name, color, label?}], the single source of
    // truth for layer colors: one class, one color, in every column. The
    // ordinal scale gets an explicit domain — an implicit one would assign
    // colors in data-encounter order, so the same class could render
    // differently across widget instances; unknown covers classless layers
    const soilClasses = model.get("soil_classes") ?? [];

    const classColor = d3
      .scaleOrdinal(
        soilClasses.map((c) => c.name),
        soilClasses.map((c) => c.color),
      )
      .unknown("#ccc") as (name: string) => string;

    const classLabel = new Map(
      soilClasses.map((c) => [c.name, c.label ?? c.name]),
    );

    // manually editable layer column: one flat layer list in the same shape
    // as an interpretation column's layers; edits sync back to Python.
    // Work on copies — mutating the model's own objects in place would make
    // the eventual model.set() look like a no-change and skip the sync
    const editedLayers = (model.get("editedLayers") ?? []).map((l) => ({
      ...l,
    }));

    const width = model.get("width") || 400;
    const height = model.get("height") || 800;

    const marginLeft = 50;
    const marginRight = 50;

    // layer columns (interpretations + edit column) extend the svg beyond
    // the plot width
    const columnWidth = 72;
    const columnGap = 8;
    const columnX = (i: number) =>
      width + columnGap + i * (columnWidth + columnGap);

    // one descriptor per layer column: the borehole sits left of the plot,
    // read-only interpretation columns right of it, then the editable
    // column; everything downstream (layout, join, placement) is driven by
    // this array
    const columns: ColumnSpec[] = [
      ...(boreholeLayers.length
        ? [
            {
              label: borehole.label ?? "",
              layers: boreholeLayers,
              side: "left" as const,
            },
          ]
        : []),
      ...interpretations.map((d) => ({
        label: d.label ?? "",
        layers: d.layers ?? [],
      })),
      ...(editedLayers.length
        ? [
            {
              label: "Edited Interpr.",
              layers: editedLayers,
              editable: true,
              // the empty separator slot sets the editable column apart
              // from the read-only interpretation columns
              gapBefore: true,
            },
          ]
        : []),
    ];

    // slot layout: left-side columns stack outward at negative x, the rest
    // to the right of the plot; a column with gapBefore leaves one slot
    // empty before it
    let slot = 0;
    let leftSlot = 0;
    for (const c of columns) {
      if (c.side === "left") {
        leftSlot += 1;
        c.x = -leftSlot * (columnWidth + columnGap);
      } else {
        if (c.gapBefore) {
          slot += 1;
        }
        c.x = columnX(slot);
        slot += 1;
      }
    }

    const totalWidth = width + slot * (columnWidth + columnGap);

    // left columns extend the viewBox into negative x instead of shifting
    // the plot: every plot coordinate stays put; the extra columnGap keeps
    // the boundary-depth labels (which reach left of the column) visible
    const x0 = leftSlot ? -leftSlot * (columnWidth + columnGap) - columnGap : 0;

    // bottom cpt axes read left-to-right, top axes right-to-left (mirrored),
    // so the two dominant curves (qc and Rf) sit back-to-back
    const series = buildSeries({
      channels,
      cptData,
      axisLimits,
      rangeBottom: [marginLeft, width - marginRight],
      rangeTop: [width - marginRight, marginLeft],
    });

    // one slot per x-axis, stacked outward from the plot edge
    const axisSlot = 30;
    const bottomSeries = series.filter((s) => s.side === "bottom");
    const topSeries = series.filter((s) => s.side === "top");
    const marginTop = 24 + axisSlot * topSeries.length;
    const marginBottom = 10 + axisSlot * bottomSeries.length;

    const y = makeVerticalScale(
      [vertical[0]!, vertical[vertical.length - 1]!],
      [marginTop, height - marginBottom],
      axisLimits[vert.key],
    );

    let zy = y; // the currently zoomed depth scale

    const xAxis = (g: AnySelection<SVGGElement>, s: Series, slotY: number) =>
      g
        .attr("transform", `translate(0,${slotY})`)
        .call(
          (s.side === "bottom" ? d3.axisBottom : d3.axisTop)(s.x).ticks(
            width / 100,
          ),
        )
        .call((g) => g.selectAll("text").attr("fill", s.color))
        .call((g) => g.selectAll("line").attr("stroke", s.color))
        .call((g) => g.select(".domain").attr("stroke", s.color))
        .call((g) =>
          g
            .append("text")
            .attr(
              "x",
              s.side === "bottom" ? marginLeft - 8 : width - marginRight + 8,
            )
            .attr("dy", "0.32em")
            .attr("fill", s.color)
            .attr("text-anchor", s.side === "bottom" ? "end" : "start")
            .attr("font-weight", "bold")
            .text(s.unit ? `${s.label} [${s.unit}]` : s.label),
        );

    // vertical gridlines follow the innermost bottom axis (qc by default)
    const gridX = bottomSeries[0]?.x ?? topSeries[0]?.x;

    const xGrid = (g: AnySelection<SVGGElement>) =>
      g
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.1)
        .selectAll("line")
        .data(gridX ? gridX.ticks(width / 100) : [])
        .join("line")
        .attr("x1", (d) => 0.5 + gridX(d))
        .attr("x2", (d) => 0.5 + gridX(d))
        .attr("y1", marginTop)
        .attr("y2", height - marginBottom);

    const yAxis = yAxisFor(marginLeft, height);

    const yGrid = yGridFor({ x1: marginLeft, x2: totalWidth, height });

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [x0, 0, totalWidth - x0, height].join(","))
      .attr("width", totalWidth - x0)
      .attr("height", height)
      .style("max-width", "100%")
      .style("height", "auto")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    const clipId = plotClip(svg, "plot-clip", {
      x: marginLeft,
      y: marginTop,
      width: width - marginLeft - marginRight,
      height: height - marginTop - marginBottom,
    });

    const gGrid = svg.append("g").call(yGrid, y);

    svg.append("g").call(xGrid);

    bottomSeries.forEach((s, i) =>
      svg.append("g").call(xAxis, s, height - marginBottom + axisSlot * i),
    );

    topSeries.forEach((s, i) =>
      svg.append("g").call(xAxis, s, marginTop - axisSlot * i),
    );

    const gy = svg.append("g").call(yAxis, y);

    verticalAxisTitle(svg, vert.label);

    for (const s of series) {
      s.path = svg
        .append("path")
        .attr("clip-path", `url(#${clipId})`)
        .attr("d", lineFor(s, vertical, y))
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 1);
    }

    const seriesByKey = new Map(series.map((s) => [s.key, s]));

    const placeOverlays = overlayLayer(svg, model.get("overlays") ?? [], {
      seriesByKey,
      clipId,
    });

    placeOverlays(y);

    const placeAnnotations = annotationLayer(svg, annotations, {
      clipId,
      marginLeft,
      marginRight,
      width,
    });

    placeAnnotations(y);

    // headers sit above the clip region so they don't scroll with zoom;
    // appended to the column group, so x is column-local
    const columnHeader = (
      column: AnySelection<SVGGElement>,
      label: (d: ColumnSpec) => string,
    ) =>
      column
        .append("text")
        .attr("x", columnWidth / 2)
        .attr("y", marginTop - 8)
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .attr("font-weight", "bold")
        .attr("fill", "currentColor")
        .text(label);

    // column-local coordinates: the clip rides along with each column
    // group's horizontal translate, so one clipPath serves every column;
    // it reaches into the gap so boundary depth labels aren't cut off
    const columnClipId = plotClip(svg, "column-clip", {
      x: -columnGap,
      y: marginTop,
      width: columnWidth + columnGap,
      height: height - marginTop - marginBottom,
    });

    // one <pattern> def per hatch char used by any column's bands
    const usedHatches = [
      ...new Set(
        columns.flatMap((c) =>
          c.layers.flatMap((l) => (l.bands ?? []).map((b) => b.hatch)),
        ),
      ),
    ].filter(Boolean) as string[];

    const hatchId = hatchDefs(svg, usedHatches);

    const layerColumn = layerRenderer({
      columnWidth,
      classColor,
      classLabel,
      hatchId,
    });

    // one group per column, translated to its slot: the header first,
    // then a clipped body holding the layers. The editable column is just
    // another datum here — its extra machinery hangs off the same nodes
    const column = svg
      .selectAll<SVGGElement, ColumnSpec>(null as unknown as string)
      .data(columns)
      .join("g")
      .attr("transform", (d) => `translate(${d.x},0)`)
      .call(columnHeader, (d: ColumnSpec) => d.label);

    const columnBody = column
      .append("g")
      .attr("clip-path", `url(#${columnClipId})`);

    const columnLayers = columnBody
      .append("g")
      .call(layerColumn, (d: ColumnSpec) => d.layers);

    const columnPlacers = [
      (y1: d3.ScaleLinear<number, number>) =>
        placeLayerColumn(columnLayers, y1),
    ];

    if (editedLayers.length) {
      // the editable column already exists in the columns join — pick its
      // nodes out by datum. Handles go in a sibling group of the layers so
      // re-joined layer rects can never paint over the handles and steal
      // their pointer events
      const layersG = columnLayers.filter((d) => Boolean(d.editable));
      const handlesG = columnBody
        .filter((d) => Boolean(d.editable))
        .append("g");

      const placeHandles = editableColumn({
        model,
        el,
        signal,
        layersG,
        handlesG,
        editedLayers,
        soilClasses,
        classLabel,
        columnWidth,
        layerColumn,
        currentY: () => zy,
      });

      columnPlacers.push(placeHandles);
    }

    const placeColumns = (y1: d3.ScaleLinear<number, number>) =>
      columnPlacers.forEach((place) => place(y1));

    placeColumns(y);

    crosshair(svg, {
      series,
      vertical,
      formatVertical: d3.format(vert.format),
      marginLeft,
      marginRight,
      width,
      currentY: () => zy,
    });

    verticalZoom(svg, {
      y,
      width,
      height,
      marginLeft,
      marginRight,
      marginTop,
      marginBottom,
      onZoom: (zy1) => {
        zy = zy1;

        gy.call(yAxis, zy);
        gGrid.call(yGrid, zy);

        for (const s of series) {
          s.path!.attr("d", lineFor(s, vertical, zy));
        }

        placeOverlays(zy);
        placeAnnotations(zy);
        placeColumns(zy);
      },
    });
  },
};
