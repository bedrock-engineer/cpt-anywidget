import type { AnyModel } from "@anywidget/types";
import { annotationLayer } from "./annotations";
import { cptChart } from "./cpt-chart";
import { crosshair } from "./crosshair";
import * as d3 from "./d3";
import { overlayLayer } from "./overlays";
import type {
  Annotation,
  AnySelection,
  AxisLimits,
  ChannelSpec,
  CptData,
  Overlay,
  Placer,
  Samples,
  VerticalSpec,
} from "./types";
import { resolveVertical } from "./vertical";
import type { ResolvedVertical } from "./vertical";
import { verticalZoom } from "./zoom";
import type { VerticalZoom } from "./zoom";

// the shared spine of every CPT chart: the traits both the CPTViewer and
// the standalone CPTLog read, and the render pipeline they both compose —
// the chart core, the zoom drive, overlays, annotations, and the hover
// crosshair. Keeping it here is what stops the two widgets drifting: they
// differ only in what they hang around this spine (the CPTViewer's layer
// columns and editing). readCore is split out so a caller can size its
// svg from the resolved traits before renderCore draws into it.

/** the traits shared by the CPT chart widgets; a widget's own model may
    carry more (the CPTViewer's columns), so readCore is generic over it */
export interface CptCoreModel {
  cptData: CptData;
  verticalKey: string | VerticalSpec;
  axisLimits: AxisLimits;
  annotations: Annotation[];
  overlays: Overlay[];
  channels: (string | ChannelSpec)[];
  width: number;
  height: number;
}

/** the plot size when the width/height traits are unset (0) */
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 800;

/** the shared traits, resolved once: defaults applied, the vertical spec
    resolved, its formatter compiled, and the vertical coordinate column
    pulled out in render order */
export interface ResolvedCore {
  cptData: CptData;
  vert: ResolvedVertical;
  /** the vertical coordinate column, first sample at the top */
  vertical: Samples;
  /** formats every reading of the vertical coordinate — crosshair
      readout and (in the CPTViewer) boundary labels */
  formatVertical: (v: number) => string;
  axisLimits: AxisLimits;
  annotations: Annotation[];
  overlays: Overlay[];
  channels: (string | ChannelSpec)[];
  width: number;
  height: number;
}

/** read and resolve the shared traits — pure, no DOM, so a caller can lay
    out around the resulting size before rendering */
export function readCore<T extends CptCoreModel>(model: AnyModel<T>): ResolvedCore {
  const cptData = model.get("cptData");
  // the contract is that the first sample renders at the top — the Python
  // facade sorts rows into that order (raw cptData= must arrive sorted)
  const vert = resolveVertical(model.get("verticalKey"), "depth");
  return {
    cptData,
    vert,
    vertical: cptData[vert.key] ?? [],
    formatVertical: d3.format(vert.format),
    axisLimits: model.get("axisLimits") ?? {},
    annotations: model.get("annotations") ?? [],
    overlays: model.get("overlays") ?? [],
    channels: model.get("channels") ?? [],
    width: model.get("width") || DEFAULT_WIDTH,
    height: model.get("height") || DEFAULT_HEIGHT,
  };
}

export interface CoreRender {
  /** the zoom drive; currentScale() is valid before apply, so callers
      building extra placers (columns, editing) read it immediately */
  vz: VerticalZoom;
  /** the plot's vertical extent in px — [top, bottom], the stacked x-axis
      margins already applied; callers place their columns within it */
  plotTop: number;
  plotBottom: number;
  /** chart core + overlays + annotations, in paint order; the caller
      appends its own placers and applies vz.placers(...) itself, so apply
      happens once, after all placers exist */
  placers: Placer[];
}

/** draw the shared chart pipeline into an already-created svg and return
    the handles a caller composes onto. gridLeft/gridRight extend the
    horizontal gridlines across a widget's side columns */
export function renderCore(
  svg: AnySelection<SVGSVGElement>,
  core: ResolvedCore,
  {
    margin,
    gridLeft,
    gridRight,
  }: {
    margin: { left: number; right: number; top: number; bottom: number };
    gridLeft?: number;
    gridRight?: number;
  },
): CoreRender {
  const { series, seriesByKey, y, clipId, place } = cptChart(svg, {
    cptData: core.cptData,
    vertical: core.vertical,
    vert: core.vert,
    channels: core.channels,
    axisLimits: core.axisLimits,
    width: core.width,
    height: core.height,
    margin,
    gridLeft,
    gridRight,
  });

  const [plotTop, plotBottom] = y.range();

  // currentScale is valid already; the crosshair below and any caller
  // placers read it before the drive is applied
  const vz = verticalZoom().scale(y).xExtent([margin.left, core.width - margin.right]);

  const placeOverlays = overlayLayer(svg, core.overlays, { seriesByKey, clipId });

  const placeAnnotations = annotationLayer(svg, core.annotations, {
    clipId,
    marginLeft: margin.left,
    marginRight: margin.right,
    width: core.width,
  });

  crosshair(svg, {
    series,
    vertical: core.vertical,
    formatVertical: core.formatVertical,
    marginLeft: margin.left,
    marginRight: margin.right,
    width: core.width,
    currentY: vz.currentScale,
  });

  return { vz, plotTop, plotBottom, placers: [place, placeOverlays, placeAnnotations] };
}
