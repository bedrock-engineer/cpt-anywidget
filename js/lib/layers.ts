import type { AnySelection, Band, Layer, VerticalScale } from "./types";

/** band datum with its layer's vertical extent copied on */
type PlacedBand = Band & { top: number; bottom: number };

/** re-callable column renderer bound to a display config; layers is an
    array or an accessor of the column datum */
export type LayerColumn = (
  parent: AnySelection<SVGGElement>,
  layers: Layer[] | ((d: any) => Layer[]),
) => void;

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
}: {
  columnWidth: number;
  classColor: (name: string) => string;
  classLabel: Map<string, string>;
  hatchId: Map<string, string>;
}): LayerColumn {
  const labelMargin = 14; // space for depth labels on boundary lines

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

        g.append("text")
          .attr("class", "top-depth")
          .attr("font-size", 10)
          .attr("x", 10)
          .attr("dominant-baseline", "middle")
          .attr("text-anchor", "end");

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
        d.bands
          ? "none"
          : d.class != null
            ? classColor(d.class)
            : (d.color ?? "#ccc"),
      );
    layerGroup
      .select("text.soil-label")
      .text((d) =>
        d.bands ? "" : (d.label ?? classLabel.get(d.class!) ?? d.class ?? ""),
      );

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
  };
}

// placement re-selects instead of closing over the join, so it stays
// valid across re-joins; a function of the current (zoomed) scale
export function placeLayerColumn(
  parent: AnySelection<SVGGElement>,
  y1: VerticalScale,
): void {
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

  layerGroup
    .select("text.soil-label")
    .attr("y", (d) => (y1(d.top) + y1(d.bottom)) / 2);

  layerGroup
    .select("text.top-depth")
    .attr("y", (d) => y1(d.top))
    .text((d) => d.top.toFixed(1));
}
