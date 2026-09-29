import type { AnyModel, RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { hatchDefs } from "./lib/hatch";
import { readCore, renderCore } from "./lib/cpt-core";
import { layerRenderer, placeLayerColumn } from "./lib/layers";
import { plotClip } from "./lib/frame";
import { editableColumn, laneExtent } from "./lib/editing";
import type {
  Annotation,
  AnySelection,
  AxisLimits,
  Borehole,
  ChannelSpec,
  ColumnGeometry,
  ColumnSpec,
  CptData,
  Interpretation,
  Layer,
  Overlay,
  SoilClass,
  VerticalSpec,
} from "./lib/types";
import { layoutColumns } from "./lib/layout-columns";

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

export default {
  /** @param context the model shared by every view of this widget */
  initialize(_context: { model: AnyModel<CptModel>; signal: AbortSignal }) {
    // Set up shared state, event handlers, or programmatic exports.
    // Use the context's `signal` for cleanup when the widget is destroyed.
  },
  render({ model, el, signal: hostSignal }: RenderProps<CptModel>) {
    // marimo's anywidget host predates the AFM `signal` prop and passes
    // undefined; synthesize one so abort-based cleanup works everywhere.
    // The returned dispose function is the part every host honors.
    const controller = new AbortController();
    hostSignal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
    const signal = controller.signal;

    // the shared chart spine — cptData, the resolved vertical + its
    // formatter, axis limits, annotations, overlays, channels, size —
    // read exactly as the standalone CPTLog reads them (renderCore draws
    // it below). vertical/formatVertical are also used by this widget's
    // columns, so pull them out
    const core = readCore(model);
    const { vertical, formatVertical, width, height } = core;

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
      .unknown("#ccc");

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

    // should this be configurable too?
    const margin = {
      left: 70,
      right: 50,
      top: 10,
      bottom: 10,
    };

    // layer columns (interpretations + edit column) extend the svg beyond
    // the plot width
    const column: ColumnGeometry = { width: 72, gap: 8 };

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
      // always present, even with no layers yet: the empty column offers
      // the click-to-start gesture, so interpreting needs no seed
      {
        label: "Edited Interpr.",
        layers: editedLayers,
        editable: true,
        // the empty separator slot sets the editable column apart
        // from the read-only interpretation columns
        gapBefore: true,
      },
    ];

    const { totalWidth, x0 } = layoutColumns(columns, width, column);

    // horizontal gridlines span every layer column: right to the last
    // column's edge, and — when a borehole sits left of the plot — left
    // to its outer edge too, so both sides read against the same ticks
    const leftColumns = columns.filter((c) => c.side === "left");
    const gridLeft = leftColumns.length
      ? Math.min(...leftColumns.map((c) => c.x ?? 0))
      : undefined;

    // the edit column carries the structure lane on its outer edge,
    // past the slot layout's extent
    const svgRight = totalWidth + laneExtent;

    // interpretation headers can be long (e.g. "Bro Interpretation") and,
    // rendered horizontally, overflow their 72px column into the next.
    // Angling them 45° up and to the right fans them into parallel
    // diagonals — the 80px column pitch keeps them clear at any length.
    // Reserve room for the angled run: a bold 12px glyph is ~0.6em wide,
    // and the 45° rotation turns the run length into an equal rise above
    // the plot (grown into the top margin) and a rightward drift past the
    // last column (grown onto the right of the viewBox)
    const headerFontSize = 12;
    const longestHeaderPx =
      Math.max(0, ...columns.map((c) => c.label.length)) * headerFontSize * 0.6;
    const headerRise =
      Math.ceil(longestHeaderPx * Math.SQRT1_2) + headerFontSize;
    margin.top = Math.max(margin.top, headerRise);
    const rightReserve = headerRise;

    const svg = d3
      .select(el)
      .append("svg")
      .attr(
        "viewBox",
        [x0, 0, svgRight - x0 + rightReserve, height].join(","),
      )
      .attr("width", svgRight - x0 + rightReserve)
      .attr("height", height)
      .style("max-width", "100%")
      .style("height", "auto")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    // the shared chart spine: curves, stacked x axes, grids, the vertical
    // axis, plus overlays, annotations and the hover crosshair. Returns
    // the zoom drive, the plot's vertical extent, and the base placers
    // this widget appends its column placer to
    const { vz, plotTop, plotBottom, placers } = renderCore(svg, core, {
      margin,
      // gridlines reach across the layer columns, both sides
      gridLeft,
      gridRight: totalWidth,
    });

    // headers sit above the clip region so they don't scroll with zoom;
    // appended to the column group, so x is column-local
    const columnHeader = (
      g: AnySelection<SVGGElement>,
      label: (d: ColumnSpec) => string,
    ) =>
      g
        .append("text")
        .attr("class", "column-header")
        .attr(
          "transform",
          `translate(${column.width / 2},${plotTop - 6}) rotate(-45)`,
        )
        .attr("text-anchor", "start")
        .attr("dominant-baseline", "middle")
        .attr("font-size", headerFontSize)
        .attr("font-weight", "bold")
        .attr("fill", "currentColor")
        .text(label);

    // column-local coordinates: the clip rides along with each column
    // group's horizontal translate, so one clipPath serves every column;
    // it reaches into the gap so boundary depth labels aren't cut off
    const columnClipId = plotClip(svg, "column-clip", {
      x: -column.gap,
      y: plotTop,
      width: column.width + column.gap,
      height: plotBottom - plotTop,
    });

    // one <pattern> def per hatch char used by any column's bands
    const usedHatches = [
      ...new Set(
        columns.flatMap((c) =>
          c.layers.flatMap((l) => (l.bands ?? []).map((b) => b.hatch)),
        ),
      ),
    ].filter((d): d is string => Boolean(d));

    const hatchId = hatchDefs(svg, usedHatches);

    const layerColumn = layerRenderer({
      columnWidth: column.width,
      classColor,
      classLabel,
      hatchId,
      formatBoundary: formatVertical,
    });

    // one group per column, translated to its slot: the header first,
    // then a clipped body holding the layers. The editable column is just
    // another datum here — its extra machinery hangs off the same nodes
    const gColumn = svg
      .selectAll<SVGGElement, ColumnSpec>("g.column")
      .data(columns)
      .join("g")
      .attr("class", "column")
      .attr("transform", (d) => `translate(${d.x},0)`)
      .call(columnHeader, (d: ColumnSpec) => d.label);

    const columnBody = gColumn
      .append("g")
      .attr("clip-path", `url(#${columnClipId})`);

    const columnLayers = columnBody
      .append("g")
      .call(layerColumn, (d: ColumnSpec) => d.layers);

    // the editable column already exists in the columns join — pick its
    // nodes out by datum. Handles go in a sibling group of the layers so
    // re-joined layer rects can never paint over the handles and steal
    // their pointer events
    const layersG = columnLayers.filter((d) => Boolean(d.editable));
    const handlesG = columnBody.filter((d) => Boolean(d.editable)).append("g");

    // the structure lane sits outside the column clip — its strip and
    // previews live in the lane's own x band and span the plot height
    const laneG = gColumn.filter((d) => Boolean(d.editable)).append("g");

    const editColumn = editableColumn({
      model,
      el,
      signal,
      layersG,
      handlesG,
      laneG,
      editedLayers,
      soilClasses,
      classLabel,
      columnWidth: column.width,
      plotTop,
      plotBottom,
      // a first layer created in the empty column spans the sounding's
      // data extent (first to last sample, in the vertical coordinate)
      verticalExtent: [vertical[0] ?? 0, vertical[vertical.length - 1] ?? 0],
      layerColumn,
      currentY: vz.currentScale,
    });

    // double-click a read-only interpretation's header to seed the edit
    // column from it — a full re-seed, discarding current edits (no undo,
    // so it's a deliberate double-click, and stopPropagation keeps it off
    // the svg's double-click zoom reset). The .seedable hover style hints
    // the header is actionable
    gColumn
      .filter((d) => !d.side && !d.editable)
      .select<SVGTextElement>("text.column-header")
      .classed("seedable", true)
      .on("dblclick", (event: MouseEvent, d) => {
        event.stopPropagation();
        editColumn.seedFrom(d.layers);
      })
      // native tooltip spelling out the gesture — the hover underline hints
      // it's actionable, the title says what the action is
      .append("title")
      .text("Double-click to seed the editable column from this interpretation");

    // layer rects for every column plus the edit column's drag handles,
    // together on each zoom frame
    const placeColumns = (y1: d3.ScaleLinear<number, number>) => {
      placeLayerColumn(columnLayers, y1);
      editColumn.place(y1);
    };

    // apply the zoom drive: it runs the initial placement pass, re-places
    // on every zoom, and its brush overlay re-raises itself on hover. The
    // widget's column placer runs after the shared base placers
    svg.call(vz.placers([...placers, placeColumns]));

    return () => controller.abort();
  },
};
