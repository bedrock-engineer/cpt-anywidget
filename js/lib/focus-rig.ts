import type { AnySelection } from "./types";

// the shared crosshair skin — the presentation every viewer's crosshair
// has in common: a hidden focus group holding the rule across the plot
// and the halo-styled vertical readout against the axis. Hover semantics
// stay with the caller: what a hover hits (a sample, a layer, a bare
// position) is each viewer's own affair — see
// docs/adr/0001-crosshair-variants-stay-separate.md. The rig only
// builds, shows at a pixel, and hides.

/** white halo keeping readouts legible over curves and soil fills */
export const haloText = (text: AnySelection<SVGTextElement>) =>
  text.attr("stroke", "white").attr("stroke-width", 4).attr("paint-order", "stroke");

export interface FocusRig {
  /** the group; callers append their own extra readouts to it */
  focus: AnySelection<SVGGElement>;
  /** the rule; a caller with a live plot width retargets its x2 */
  rule: AnySelection<SVGLineElement>;
  /** the vertical-value text on the axis; the caller sets its text */
  readout: AnySelection<SVGTextElement>;
  /** translate the group to pixel ym and reveal it */
  show: (ym: number) => void;
  hide: () => void;
}

export function focusRig(
  svg: AnySelection<SVGSVGElement>,
  {
    marginLeft,
    ruleX2,
    readoutHost,
  }: {
    marginLeft: number;
    ruleX2: number;
    /** append the readout into this svg instead of the focus group — a
        pinned overlay keeps the value at the viewport edge while a wide
        chart scrolls under it. Same pixel coordinates as the chart svg */
    readoutHost?: AnySelection<SVGSVGElement>;
  },
): FocusRig {
  const focus = svg.append("g").attr("display", "none").attr("pointer-events", "none");

  const rule = focus
    .append("line")
    .attr("x1", marginLeft)
    .attr("x2", ruleX2)
    .attr("stroke", "currentColor")
    .attr("stroke-opacity", 0.3);

  const readoutGroup = readoutHost
    ? readoutHost.append("g").attr("display", "none").attr("pointer-events", "none")
    : focus;

  const readout = readoutGroup
    .append("text")
    .attr("x", marginLeft - 8)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .attr("font-size", 12)
    .attr("font-weight", "bold")
    .attr("fill", "currentColor")
    .call(haloText);

  const groups = readoutGroup === focus ? [focus] : [focus, readoutGroup];

  return {
    focus,
    rule,
    readout,
    show: (ym) =>
      groups.forEach((g) => g.attr("display", null).attr("transform", `translate(0,${ym})`)),
    hide: () => groups.forEach((g) => g.attr("display", "none")),
  };
}
