import { select } from "./d3";
import { dodgeLabels } from "./label-dodge";
import type { AnySelection, Band, Layer, VerticalScale } from "./types";

/** band datum with its layer's vertical extent copied on */
type PlacedBand = Band & { top: number; bottom: number };

// strip left of the rects for depth labels, sized so a signed
// two-decimal NAP value ("+12.50", ~31px at 10px font) clears the clip
// edge 8px into the inter-column gap
export const labelMargin = 28;
const labelTextX = labelMargin - 4; // right edge of the depth text
const leaderEndX = labelMargin - 3; // leaders stop just short of the text
// both Bézier control points sit at the midpoint x, so the leader
// leaves the boundary and meets the label horizontally (an S-curve)
const leaderMidX = (labelMargin + leaderEndX) / 2;
const depthLabelHeight = 12; // 10px font + breathing room: the dodge separation

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

  return (parent, layers) => {
    const layerGroup = parent
      .selectAll<SVGGElement, Layer>("g.layer")
      .data(layers as Layer[])
      .join((enter) => {
        const g = enter.append("g").attr("class", "layer");

        g.append("rect")
          .attr("x", labelMargin)
          .attr("width", columnWidth - labelMargin)
          .attr("stroke", "white");

        g.append("text")
          .attr("class", "soil-label")
          .attr("x", columnWidth / 2 + labelMargin / 2)
          .attr("dy", "0.32em")
          .attr("text-anchor", "middle")
          .attr("font-size", 10)
          .attr("fill", "#333")
          .attr("stroke", "white")
          .attr("stroke-width", 1.5)
          .attr("paint-order", "stroke");

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
    layerGroup
      .select("text.soil-label")
      .text((d) => (d.bands ? "" : (d.label ?? classLabel.get(d.class!) ?? d.class ?? "")));

    // banded layers get their (long) soil name as a native tooltip
    // instead of an overflowing label
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
      .attr("stroke", "white")
      .attr("stroke-width", 0.5);

    layerGroup
      .selectAll<SVGRectElement, PlacedBand>("rect.hatch")
      .data((d) => bandData(d).filter((b) => b.hatch))
      .join("rect")
      .attr("class", "hatch")
      .call(bandX)
      .attr("fill", (b) => `url(#${hatchId.get(b.hatch!)})`);

    // boundary depth labels are their own join, sibling to the layers:
    // one per layer top plus the last layer's bottom. Datums reference
    // the live layer object (drags mutate layers in place without a
    // re-join), so placement reads the value through per frame; they
    // also carry the formatter, which is how it reaches the placement
    // pass (placement re-selects rather than closing over the renderer)
    const boundaryData = (d: any): Boundary[] => {
      const ls = typeof layers === "function" ? layers(d) : layers;
      const last = ls[ls.length - 1];
      return ls.length
        ? [
            ...ls.map((l: Layer) => ({
              layer: l,
              which: "top" as const,
              format: formatBoundary,
            })),
            { layer: last, which: "bottom" as const, format: formatBoundary },
          ]
        : [];
    };

    parent
      .selectAll<SVGGElement, Boundary>("g.boundary")
      .data(boundaryData)
      .join((enter) => {
        const g = enter.append("g").attr("class", "boundary");

        g.append("text")
          .attr("font-size", 10)
          .attr("x", labelTextX)
          .attr("dominant-baseline", "middle")
          .attr("text-anchor", "end");

        g.append("path").attr("fill", "none").attr("stroke", "#888").attr("stroke-width", 0.75);

        return g;
      });
  };
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

  layerGroup.select("text.soil-label").attr("y", (d) => (y1(d.top) + y1(d.bottom)) / 2);

  // depth labels dodge per column — each parent node is one column with
  // its own boundary set
  parent.each(function () {
    placeDepthLabels(select(this), y1);
  });
}

/** one depth label on a layer boundary: every layer's top plus the last
    layer's bottom, reading through to the live layer object */
interface Boundary {
  layer: Layer;
  which: "top" | "bottom";
  format: (value: number) => string;
}

// boundary depth labels with 1D dodging: labels keep their boundary's
// position until they'd overlap, then colliding runs spread apart
// (order preserved, minimal displacement) and each displaced label gets
// a leader line back to its boundary. A pure function of the zoomed
// scale: zooming in relaxes labels back to their anchors and the
// leaders disappear
function placeDepthLabels(column: AnySelection<SVGGElement>, y1: VerticalScale): void {
  const boundarySel = column.selectAll<SVGGElement, Boundary>("g.boundary");
  const nodes = boundarySel.nodes();
  const data = boundarySel.data();
  if (!nodes.length) {
    return;
  }

  // cull boundaries zoomed out of view: they neither render nor push
  // visible labels around. Layer order puts anchors ascending in pixels
  // (first layer renders at the top in both depth and nap mode), which
  // is what the dodge requires
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

  // half a label of padding keeps the edge labels fully inside the clip
  const placed = dodgeLabels(
    visible.map((i) => anchors[i]),
    depthLabelHeight,
    [lo + depthLabelHeight / 2, hi - depthLabelHeight / 2],
  );

  const posByIndex = new Map<number, number>();
  visible.forEach((bi, j) => posByIndex.set(bi, placed[j]));

  nodes.forEach((node, i) => {
    const g = select(node);
    const p = posByIndex.get(i);
    if (p === undefined) {
      g.attr("display", "none");
      return;
    }
    g.attr("display", null);

    g.select("text").attr("y", p).text(data[i].format(data[i].layer[data[i].which]));

    // a leader only where the dodge actually displaced the label
    const displaced = Math.abs(p - anchors[i]) > 0.5;
    g.select("path")
      .attr("display", displaced ? null : "none")
      .attr(
        "d",
        displaced
          ? `M${labelMargin},${anchors[i]}C${leaderMidX},${anchors[i]} ${leaderMidX},${p} ${leaderEndX},${p}`
          : null,
      );
  });
}
