import type { RenderProps } from "@anywidget/types";
import { annotationLayer } from "./lib/annotations";
import * as d3 from "./lib/d3";
import { focusRig, haloText } from "./lib/focus-rig";
import { makeVerticalScale, plotClip, verticalAxisTitle, yAxisFor } from "./lib/frame";
import { hatchDefs } from "./lib/hatch";
import type { Annotation, AxisLimits, Band, Layer, VerticalSpec } from "./lib/types";
import { resolveVertical } from "./lib/vertical";
import { verticalZoom } from "./lib/zoom";

/** the synced traits — the TS mirror of BHRGTViewer's traitlets */
interface BhrgtModel {
  layers: Layer[];
  verticalKey: string | VerticalSpec;
  axisLimits: AxisLimits;
  annotations: Annotation[];
  width: number;
  height: number;
}

/** band datum with its layer attached, for placement without lookups */
type LayerBand = Band & { layer: Layer };

export default {
  render({ model, el }: RenderProps<BhrgtModel>) {
    // [{top, bottom, label, bands: [{x1, x2, color, hatch?}]}] — top/bottom
    // in the current vertical coordinate, band x proportional in [0, 1]
    const layers = model.get("layers") ?? [];

    // only the axis label/format depends on this; direction follows the
    // layer order — first layer renders at the top either way
    const vert = resolveVertical(model.get("verticalKey"), "depth");

    // optional {verticalKey: [min, max]} override for the vertical axis
    const axisLimits = model.get("axisLimits") ?? {};

    // horizontal reference lines, e.g. groundwater — same contract as CPT
    const annotations = model.get("annotations") ?? [];

    const width = model.get("width") || 220;
    const height = model.get("height") || 800;

    const marginLeft = 50;
    const marginRight = 20;
    const marginTop = 24;
    const marginBottom = 10;

    const x = d3
      .scaleLinear()
      .domain([0, 1])
      .range([marginLeft, width - marginRight]);

    const first = layers[0];
    const last = layers[layers.length - 1];

    const y = makeVerticalScale(
      [first?.top ?? 0, last?.bottom ?? 1],
      [marginTop, height - marginBottom],
      axisLimits[vert.key],
    );

    const yAxis = yAxisFor(marginLeft, height);

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [0, 0, width, height].join(","))
      .attr("width", width)
      .attr("height", height)
      // user-select suppresses text selection during drags/brushes; the
      // -webkit- prefix is still required in Safari
      .attr(
        "style",
        "max-width: 100%; height: auto; user-select: none; -webkit-user-select: none;",
      );

    const clipId = plotClip(svg, "bhrgt-clip", {
      x: marginLeft,
      y: marginTop,
      width: width - marginLeft - marginRight,
      height: height - marginTop - marginBottom,
    });

    // one <pattern> def per hatch char actually used by the data
    const usedHatches = [
      ...new Set(layers.flatMap((l) => (l.bands ?? []).map((b) => b.hatch))),
    ].filter(Boolean) as string[];

    const hatchId = hatchDefs(svg, usedHatches);

    // placed by the zoom drive, like everything else on the vertical scale
    const gy = svg.append("g");

    verticalAxisTitle(svg, vert.label);

    // flatten the layers into one band array up front — band datums carry
    // their layer, so rendering is two flat joins (colour rects + hatch
    // overlays) and placement stays a function of the current zoomed scale
    const bands: LayerBand[] = layers.flatMap((layer) =>
      (layer.bands ?? []).map((b) => ({ ...b, layer })),
    );

    // horizontal extent is static (only y zooms), shared by both joins
    const bandX = (rect: d3.Selection<SVGRectElement, LayerBand, SVGGElement, unknown>) =>
      rect.attr("x", (b) => x(b.x1)).attr("width", (b) => x(b.x2) - x(b.x1));

    const gLayers = svg.append("g").attr("clip-path", `url(#${clipId})`);

    const bandRect = gLayers
      .selectAll<SVGRectElement, LayerBand>("rect")
      .data(bands)
      .join("rect")
      .call(bandX)
      .attr("fill", (b) => b.color)
      .attr("stroke", "white")
      .attr("stroke-width", 0.5);

    const hatchRect = gLayers
      .selectAll<SVGRectElement, LayerBand>(null as unknown as string)
      .data(bands.filter((b) => b.hatch))
      .join("rect")
      .call(bandX)
      .attr("fill", (b) => `url(#${hatchId.get(b.hatch!)})`);

    // white halo keeps names legible over the dark soil bands; visibility
    // is decided per zoom level — labels appear as their layer gets tall
    // enough in pixels
    const soilLabel = gLayers
      .selectAll<SVGTextElement, Layer>("text")
      .data(layers)
      .join("text")
      .attr("x", x(0.5))
      .attr("dy", "0.32em")
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "#333")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .attr("paint-order", "stroke")
      .text((l) => l.label ?? "");

    const placeLayers = (y1: d3.ScaleLinear<number, number>) => {
      for (const rect of [bandRect, hatchRect]) {
        rect
          .attr("y", (b) => Math.min(y1(b.layer.top), y1(b.layer.bottom)))
          .attr("height", (b) => Math.abs(y1(b.layer.bottom) - y1(b.layer.top)));
      }

      soilLabel
        .attr("y", (l) => (y1(l.top) + y1(l.bottom)) / 2)
        .attr("display", (l) => (Math.abs(y1(l.bottom) - y1(l.top)) >= 14 ? null : "none"));
    };

    const placeAnnotations = annotationLayer(svg, annotations, {
      clipId,
      marginLeft,
      marginRight,
      width,
    });

    // format from the resolved spec: signed for NAP so values near the
    // datum read unambiguously
    const formatVertical = d3.format(vert.format);

    // crosshair at the hovered elevation: the shared skin from the rig,
    // plus this log's own extra readout — the hovered layer's soil name
    const rig = focusRig(svg, { marginLeft, ruleX2: width - marginRight });

    const layerReadout = rig.focus
      .append("text")
      .attr("x", width - marginRight - 6)
      .attr("y", -6)
      .attr("text-anchor", "end")
      .attr("font-size", 12)
      .attr("fill", "#333")
      .call(haloText);

    // bisect matching the layer direction: depth tops ascend, nap tops
    // descend; the candidate is the last layer starting at or above the
    // value, then containment rejects values past its bottom (gaps, ends)
    const bisectTop =
      layers.length < 2 || layers[0].top <= layers[1].top
        ? d3.bisector((l: Layer) => l.top).right
        : d3.bisector((l: Layer, v: number) => v - l.top).right;

    const layerAt = (value: number) => {
      const l = layers[bisectTop(layers, value) - 1];
      return l && value >= Math.min(l.top, l.bottom) && value <= Math.max(l.top, l.bottom)
        ? l
        : undefined;
    };

    function pointermoved(event: PointerEvent) {
      const [, ym] = d3.pointer(event);
      const value = current().invert(ym);
      const layer = layerAt(value);

      if (!layer) {
        rig.hide();
        return;
      }

      rig.show(ym);

      rig.readout.text(`${formatVertical(value)} m`);
      layerReadout.text(layer.label ?? "");
    }

    svg.on("pointerenter pointermove", pointermoved).on("pointerleave", rig.hide);

    // last on purpose: the zoom drive appends the brush overlay, which
    // must stay on top. It runs the initial placement pass and re-places
    // on every zoom
    const current = verticalZoom(svg, {
      y,
      width,
      height,
      marginLeft,
      marginRight,
      marginTop,
      marginBottom,
      placers: [(y1) => gy.call(yAxis, y1), placeLayers, placeAnnotations],
    });
  },
};
