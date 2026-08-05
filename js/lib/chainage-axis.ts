import * as d3 from "./d3";
import type { AnySelection } from "./types";
import type { StripLayout } from "./strip-layout";

// the dual-mode chainage axis under the profile's strips. True scale
// draws an honest linear meter axis; when the anchors don't carry
// distance (equal spacing, or a profile of one tied chainage) the line
// and ticks would lie about proportion, so it degrades to plain labels
// — one chainage per tied run, centered under the run, so crest + toe
// pairs read as one dijkpaal.
//
// The returned component accepts a selection or a transition (the
// spacing toggle animates the true-scale ticks) and takes the live
// spacing state as a .call argument, like an axis takes its scale

export function chainageAxisFor(layout: StripLayout) {
  const { distances, span, groups, anchorX, innerLeft, innerRight } = layout;
  const n = distances.length;

  const formatDistance = d3.format(",.0f");

  return (
    gOrT: any,
    { equal, centers }: { equal: boolean; centers: number[] },
  ) => {
    if (n < 2) {
      return;
    }
    // Transition.selection() unwraps; Selection.selection() is identity
    const selection: AnySelection<SVGGElement> = gOrT.selection();

    if (!equal && span > 0) {
      selection.selectAll("text.chain-label").remove();
      gOrT.call(
        d3
          .axisBottom(
            d3
              .scaleLinear()
              .domain([distances[0], distances[n - 1]])
              .range([anchorX(distances[0]), anchorX(distances[n - 1])]),
          )
          .ticks((innerRight - innerLeft) / 90)
          .tickFormat((d: d3.NumberValue) => formatDistance(+d))
          .tickSizeOuter(0) as any,
      );
      return;
    }

    selection.selectAll(".tick,.domain").remove();

    const labelX = (gr: { idx: number[] }) =>
      gr.idx.reduce((s, i) => s + centers[i], 0) / gr.idx.length;

    type Group = (typeof groups)[number];

    // entering labels place directly at labelX, so the transition below
    // is a no-op for them — only surviving labels visibly slide
    const labels = selection
      .selectAll<SVGTextElement, Group>("text.chain-label")
      .data(groups)
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "chain-label")
          .attr("y", 9)
          .attr("dy", "0.71em")
          .attr("text-anchor", "middle")
          .attr("font-size", 10)
          .attr("fill", "currentColor")
          .attr("x", labelX)
          .text((gr) => formatDistance(gr.dist)),
      );

    if (gOrT !== selection) {
      labels.transition(gOrT).attr("x", labelX);
    } else {
      labels.attr("x", labelX);
    }
  };
}
