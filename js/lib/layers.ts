import { select } from "./d3";
import { haloText } from "./focus-rig";
import type { AnySelection, Band, Layer, VerticalScale } from "./types";
import { wrapLines } from "./wrap";

/** band datum with its layer's vertical extent copied on */
type PlacedBand = Band & { top: number; bottom: number };

// strip beside the rects for depth labels, sized so a signed
// two-decimal NAP value ("+12.50", ~31px at 10px font) clears the clip
// edge 8px into the inter-column gap
export const labelMargin = 28;
const depthLabelHeight = 12; // 10px font + breathing room: the dodge separation

// soil-name label geometry: a 10px font, wrapped to the fill width and
// vertically centered. soilLineHeight doubles as the thin-layer hide
// threshold — a layer shorter than the wrapped block's height (line
// count times this) drops its whole label rather than clipping it
const soilLabelFontSize = 10;
const soilLineHeight = 11;

/** which side of the rects the label strip sits on — the CPT columns
    label on the left, the borehole log on the right */
export type LabelSide = "left" | "right";

// strip-local geometry per side: the rect edge is at x=labelMargin
// (left strip) or x=0 (right strip); text hugs the outer edge
const labelGeometry = {
  left: { textX: labelMargin - 4, anchor: "end" },
  right: { textX: 4, anchor: "start" },
} as const;

/** re-callable column renderer bound to a display config; layers is an
    array or an accessor of the column datum */
export type LayerColumn = (
  parent: AnySelection<SVGGElement>,
  layers: Layer[] | ((d: any) => Layer[]),
) => void;

interface LayerRenderer {
  columnWidth: number;
  classColor: (name: string) => string;
  classLabel: Map<string, string>;
  hatchId: Map<string, string>;
  /** formats boundary depth labels — a compiled d3-format of the
      vertical spec's format, so labels match the crosshair readout */
  formatBoundary: (value: number) => string;
}

// a layer column: rects + centered labels on the shared vertical scale,
// no x axis — used by the interpretation columns and the edit column.
// The factory binds the display config; the returned layerColumn works
// in column-local coordinates on a (possibly multi-node) column
// selection. re-callable: the keyed join adds/removes nodes in place,
// so the edit column can .call() it again after structural edits
// (split/merge)
export function layerRenderer({
  columnWidth,
  classColor,
  classLabel,
  hatchId,
  formatBoundary,
}: LayerRenderer): LayerColumn {
  // soil-composition bands: proportional x in [0, 1] across the fill
  // area; band datums copy their layer's extent so vertical placement
  // needs no parent lookup
  const bandData = (d: Layer): PlacedBand[] =>
    (d.bands ?? []).map((b) => ({ ...b, top: d.top, bottom: d.bottom }));

  const bandX = (rect: AnySelection<SVGRectElement>) =>
    rect
      .attr("x", (b: PlacedBand) => labelMargin + b.x1 * (columnWidth - labelMargin))
      .attr("width", (b: PlacedBand) => (b.x2 - b.x1) * (columnWidth - labelMargin));

  // characters that fit the fill width at the label font (glyphs
  // estimated at half the font size, matching the borehole gutter wrap)
  const labelMaxChars = Math.max(
    1,
    Math.floor((columnWidth - labelMargin - 4) / (soilLabelFontSize * 0.5)),
  );
  const labelCenterX = columnWidth / 2 + labelMargin / 2;

  return (parent, layers) => {
    const layerGroup = parent
      .selectAll<SVGGElement, Layer>("g.layer")
      .data(layers as Layer[])
      .join((enter) => {
        const g = enter.append("g").attr("class", "layer");

        g.append("rect")
          .attr("x", labelMargin)
          .attr("width", columnWidth - labelMargin)
          // Canvas: separator hairlines in the page background color,
          // dark-page aware like the haloText backdrop
          .style("stroke", "Canvas");

        // wrapped soil name: tspans carry the fill-width center x, the
        // line-stacked y is set per frame in placeLayerColumn
        g.append("text")
          .attr("class", "soil-label")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", soilLabelFontSize)
          .attr("fill", "#333")
          .call(haloText);

        g.append("title");

        return g;
      });

    // data-dependent attrs on the merged selection: after a re-join,
    // surviving nodes may carry a different layer than before.
    // class-derived color wins so a class can't drift out of sync with
    // its fill; explicit color/label are the fallback for interpretation
    // layers, whose class systems live outside the palette. layers with
    // bands paint those instead of the base rect
    layerGroup
      .select("rect")
      .attr("fill", (d) =>
        d.bands ? "none" : d.class != null ? classColor(d.class) : (d.color ?? "#ccc"),
      );
    // every layer names its soil, banded borehole layers included — the
    // name wraps on its own whitespace to the fill width, halos over the
    // bands, and hides when the layer is too thin (placeLayerColumn), same
    // as the interpretation columns and the standalone borehole log. The
    // label is shown as authored: any word-splitting (e.g. of a camelCase
    // soil name) is the caller's to do upstream, not ours to guess
    layerGroup.select<SVGTextElement>("text.soil-label").each(function (d) {
      const label = d.label ?? classLabel.get(d.class!) ?? d.class ?? "";
      select(this)
        .selectAll<SVGTSpanElement, string>("tspan")
        .data(wrapLines(label, labelMaxChars))
        .join("tspan")
        .attr("x", labelCenterX)
        .text((line) => line);
    });

    // banded layers also carry the full, untruncated soil name as a
    // native tooltip — the wrapped label may drop lines on a thin layer
    layerGroup.select("title").text((d) => (d.bands ? (d.label ?? "") : ""));

    // hatch overlays are a sibling join so a band can carry both a
    // colour and a pattern
    layerGroup
      .selectAll<SVGRectElement, PlacedBand>("rect.band")
      .data(bandData)
      .join("rect")
      .attr("class", "band")
      .call(bandX)
      .attr("fill", (b) => b.color)
      .style("stroke", "Canvas")
      .attr("stroke-width", 0.5);

    layerGroup
      .selectAll<SVGRectElement, PlacedBand>("rect.hatch")
      .data((d) => bandData(d).filter((b) => b.hatch))
      .join("rect")
      .attr("class", "hatch")
      .call(bandX)
      .attr("fill", (b) => `url(#${hatchId.get(b.hatch!)})`);

    // the band/hatch rects join after the label in the DOM, so lift the
    // soil name back above them — otherwise the bands paint over it
    layerGroup.select("text.soil-label").raise();

    // boundary depth labels are their own join, sibling to the layers:
    // one per layer top plus the last layer's bottom. Datums reference
    // the live layer object (drags mutate layers in place without a
    // re-join), so placement reads the value through per frame; they
    // also carry the formatter, which is how it reaches the placement
    // pass (placement re-selects rather than closing over the renderer)
    boundaryLabels(parent, (d: any) =>
      boundaryData(typeof layers === "function" ? layers(d) : layers, formatBoundary),
    );
  };
}

/** boundary label datums for a layer stack: every layer's top plus the
    last layer's bottom, carrying the formatter placement reads back */
export function boundaryData(layers: Layer[], format: (value: number) => string): Boundary[] {
  const last = layers[layers.length - 1];
  return layers.length
    ? [
        ...layers.map((l) => ({ layer: l, which: "top" as const, format })),
        { layer: last, which: "bottom" as const, format },
      ]
    : [];
}

/** join the boundary label skeletons (text only) under parent, in
    strip-local coordinates (the label strip spans [0, labelMargin]);
    placeDepthLabels does all placement, thinning, and text — the side
    only sets which edge the text hugs, so placement takes none */
export function boundaryLabels(
  parent: AnySelection<SVGGElement>,
  data: Boundary[] | ((d: any) => Boundary[]),
  side: LabelSide = "left",
): void {
  const geom = labelGeometry[side];
  const sel = parent.selectAll<SVGGElement, Boundary>("g.boundary");
  (typeof data === "function" ? sel.data(data) : sel.data(data)).join((enter) => {
    const g = enter.append("g").attr("class", "boundary");

    g.append("text")
      .attr("font-size", 10)
      .attr("x", geom.textX)
      .attr("fill", "currentColor")
      .attr("dominant-baseline", "middle")
      .attr("text-anchor", geom.anchor);

    return g;
  });
}

// placement re-selects instead of closing over the join, so it stays
// valid across re-joins; a function of the current (zoomed) scale
export function placeLayerColumn(parent: AnySelection<SVGGElement>, y1: VerticalScale): void {
  const layerGroup = parent.selectAll<SVGGElement, Layer>("g.layer");

  layerGroup
    .select("rect")
    .attr("y", (d) => Math.min(y1(d.top), y1(d.bottom)))
    .attr("height", (d) => Math.abs(y1(d.bottom) - y1(d.top)));

  // band datums carry their layer's extent, so the same placement rule
  // applies without a parent lookup
  layerGroup
    .selectAll<SVGRectElement, PlacedBand>("rect.band, rect.hatch")
    .attr("y", (d) => Math.min(y1(d.top), y1(d.bottom)))
    .attr("height", (d) => Math.abs(y1(d.bottom) - y1(d.top)));

  // wrapped soil name: center the line block on the layer midpoint, but
  // hide it wholesale when the layer is too short to seat every line —
  // clipped or overflowing text reads as noise
  layerGroup.select<SVGTextElement>("text.soil-label").each(function (d) {
    const label = select(this);
    const tspans = label.selectAll<SVGTSpanElement, string>("tspan");
    const lines = tspans.size();
    const blockHeight = lines * soilLineHeight;
    const layerHeight = Math.abs(y1(d.bottom) - y1(d.top));
    if (lines === 0 || blockHeight > layerHeight) {
      label.attr("display", "none");
      return;
    }
    label.attr("display", null);
    const mid = (y1(d.top) + y1(d.bottom)) / 2;
    tspans.attr("y", (_, i) => mid + (i - (lines - 1) / 2) * soilLineHeight);
  });

  // depth labels thin per column — each parent node is one column with
  // its own boundary set
  parent.each(function () {
    placeDepthLabels(select(this), y1);
  });
}

/** one depth label on a layer boundary: every layer's top plus the last
    layer's bottom, reading through to the live layer object */
export interface Boundary {
  layer: Layer;
  which: "top" | "bottom";
  format: (value: number) => string;
}

// boundary depth labels, thinned by importance: labels stay at their
// exact boundary depth (never nudged), and where a column packs more
// boundaries than fit, only the most significant survive — the log's
// top and bottom always, then the boundaries of the thickest layers, so
// a dense run of thin interbeds collapses to its major interfaces. The
// exact depth of every dropped boundary is still one hover away on the
// crosshair readout. A pure function of the zoomed scale: zooming in
// thins less until every boundary shows
export function placeDepthLabels(column: AnySelection<SVGGElement>, y1: VerticalScale): void {
  const boundarySel = column.selectAll<SVGGElement, Boundary>("g.boundary");
  const nodes = boundarySel.nodes();
  const data = boundarySel.data();
  if (!nodes.length) {
    return;
  }

  // cull boundaries zoomed out of view: they neither render nor crowd
  // the labels that are in view
  const [r0, r1] = y1.range();
  const lo = Math.min(r0, r1);
  const hi = Math.max(r0, r1);

  const anchors = data.map((b) => y1(b.layer[b.which]));
  const visible: number[] = [];
  anchors.forEach((a, i) => {
    if (a >= lo && a <= hi) {
      visible.push(i);
    }
  });

  // clamp to half a label off each edge so the top/bottom labels sit
  // fully inside the clip rather than half-hanging past it
  const half = depthLabelHeight / 2;
  const posOf = (i: number) => Math.max(lo + half, Math.min(hi - half, anchors[i]));

  // a boundary's weight is the thicker of the two layers it separates
  // (in pixels, so it tracks zoom); the log's outer ends always win
  const pxThick = (l: Layer) => Math.abs(y1(l.bottom) - y1(l.top));
  const weightOf = (i: number) =>
    i === 0 || i === data.length - 1
      ? Infinity
      : Math.max(pxThick(data[i - 1].layer), pxThick(data[i].layer));

  // keep labels heaviest-first, accepting one only where it clears every
  // already-kept label by a full label height; ties break by depth order
  // so the pass is deterministic across frames
  const order = [...visible].sort((a, b) => weightOf(b) - weightOf(a) || a - b);
  const kept = new Map<number, number>();
  for (const i of order) {
    const p = posOf(i);
    let clears = true;
    for (const q of kept.values()) {
      if (Math.abs(p - q) < depthLabelHeight) {
        clears = false;
        break;
      }
    }
    if (clears) {
      kept.set(i, p);
    }
  }

  nodes.forEach((node, i) => {
    const g = select(node);
    const p = kept.get(i);
    if (p === undefined) {
      g.attr("display", "none");
      return;
    }
    g.attr("display", null);
    g.select("text").attr("y", p).text(data[i].format(data[i].layer[data[i].which]));
  });
}
