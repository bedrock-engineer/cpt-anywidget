import type { AnyModel, RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { hatchDefs } from "./lib/hatch";
import { cptChart } from "./lib/cpt-chart";
import { layerRenderer, placeLayerColumn } from "./lib/layers";
import { annotationLayer } from "./lib/annotations";
import { overlayLayer } from "./lib/overlays";
import { crosshair } from "./lib/crosshair";
import { plotClip } from "./lib/frame";
import { resolveVertical } from "./lib/vertical";
import { verticalZoom } from "./lib/zoom";
import { editableColumn, laneExtent } from "./lib/editing";
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

/** one layer column in the slot layout left/right of the plot */
export interface ColumnSpec {
  label: string;
  layers: Layer[];
  side?: "left";
  editable?: boolean;
  gapBefore?: boolean;
  x?: number;
}

/** column slot geometry: the fixed slot width and the gap between slots */
export interface ColumnGeometry {
  width: number;
  gap: number;
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

    const cptData = model.get("cptData");

    // which cptData column is the vertical coordinate: a key string or a
    // {key, label?, up?, format?} spec merged over the display defaults
    // for "depth" and "nap". The contract is that the first sample
    // renders at the top — the Python facade sorts rows into that order
    // (data passed raw via cptData= must arrive sorted)
    const vert = resolveVertical(model.get("verticalKey"), "depth");
    const vertical = cptData[vert.key] ?? [];

    // one compiled formatter for every reading of the vertical
    // coordinate: crosshair readout and layer boundary labels
    const formatVertical = d3.format(vert.format);

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

    const classColor: (name: string) => string = d3
      .scaleOrdinal(
        soilClasses.map((c) => c.name),
        soilClasses.map((c) => c.color),
      )
      .unknown("#ccc");

    const classLabel = new Map(soilClasses.map((c) => [c.name, c.label ?? c.name]));

    // manually editable layer column: one flat layer list in the same shape
    // as an interpretation column's layers; edits sync back to Python.
    // Work on copies — mutating the model's own objects in place would make
    // the eventual model.set() look like a no-change and skip the sync
    const editedLayers = (model.get("editedLayers") ?? []).map((l) => ({
      ...l,
    }));

    const width = model.get("width") || 400;
    const height = model.get("height") || 800;

    // should this be configurable too?
    const margin = {
      left: 70,
      right: 50,
      top: 10,
      bottom: 10,
    };
    const marginLeft = margin.left;
    const marginRight = margin.right;

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

    // the edit column carries the structure lane on its outer edge,
    // past the slot layout's extent
    const svgRight = totalWidth + laneExtent;

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [x0, 0, svgRight - x0, height].join(","))
      .attr("width", svgRight - x0)
      .attr("height", height)
      .style("max-width", "100%")
      .style("height", "auto")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    // the chart core: curves, stacked x axes, grids, the vertical axis.
    // Margins come back grown by the axis stacking; place() redraws the
    // chart's parts in the zoom loop alongside the widget's own placers
    const { series, seriesByKey, y, clipId, marginTop, marginBottom, place } = cptChart(svg, {
      cptData,
      vertical,
      vert,
      channels,
      axisLimits,
      width,
      height,
      margin,
      // gridlines reach across the layer columns
      gridRight: totalWidth,
    });

    // the zoom drive; applied at the end of setup, but currentScale is
    // valid already — the handlers built below take it directly
    const vz = verticalZoom().scale(y).xExtent([marginLeft, width - marginRight]);

    const placeOverlays = overlayLayer(svg, model.get("overlays") ?? [], {
      seriesByKey,
      clipId,
    });

    const placeAnnotations = annotationLayer(svg, annotations, {
      clipId,
      marginLeft,
      marginRight,
      width,
    });

    // headers sit above the clip region so they don't scroll with zoom;
    // appended to the column group, so x is column-local
    const columnHeader = (g: AnySelection<SVGGElement>, label: (d: ColumnSpec) => string) =>
      g
        .append("text")
        .attr("x", column.width / 2)
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
      x: -column.gap,
      y: marginTop,
      width: column.width + column.gap,
      height: height - marginTop - marginBottom,
    });

    // one <pattern> def per hatch char used by any column's bands
    const usedHatches = [
      ...new Set(
        columns.flatMap((c) => c.layers.flatMap((l) => (l.bands ?? []).map((b) => b.hatch))),
      ),
    ].filter(Boolean) as string[];

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

    const columnBody = gColumn.append("g").attr("clip-path", `url(#${columnClipId})`);

    const columnLayers = columnBody.append("g").call(layerColumn, (d: ColumnSpec) => d.layers);

    const columnPlacers = [
      (y1: d3.ScaleLinear<number, number>) => placeLayerColumn(columnLayers, y1),
    ];

    // the editable column already exists in the columns join — pick its
    // nodes out by datum. Handles go in a sibling group of the layers so
    // re-joined layer rects can never paint over the handles and steal
    // their pointer events
    const layersG = columnLayers.filter((d) => Boolean(d.editable));
    const handlesG = columnBody.filter((d) => Boolean(d.editable)).append("g");

    // the structure lane sits outside the column clip — its strip and
    // previews live in the lane's own x band and span the plot height
    const laneG = gColumn.filter((d) => Boolean(d.editable)).append("g");

    const placeHandles = editableColumn({
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
      plotTop: marginTop,
      plotBottom: height - marginBottom,
      // a first layer created in the empty column spans the sounding's
      // data extent (first to last sample, in the vertical coordinate)
      verticalExtent: [vertical[0] ?? 0, vertical[vertical.length - 1] ?? 0],
      layerColumn,
      currentY: vz.currentScale,
    });

    columnPlacers.push(placeHandles);

    const placeColumns = (y1: d3.ScaleLinear<number, number>) => {
      columnPlacers.forEach((place) => place(y1));
    };

    crosshair(svg, {
      series,
      vertical,
      formatVertical,
      marginLeft,
      marginRight,
      width,
      currentY: vz.currentScale,
    });

    // apply the zoom drive: it runs the initial placement pass, re-places
    // on every zoom, and its brush overlay re-raises itself on hover
    svg.call(vz.placers([place, placeOverlays, placeAnnotations, placeColumns]));

    return () => controller.abort();
  },
};
