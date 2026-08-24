import type { AnySelection } from "./types";

// the shared crosshair skin — the presentation every viewer's crosshair
// has in common: a hidden focus group holding the rule across the plot
// and the halo-styled vertical readout against the axis. Hover semantics
// stay with the caller: what a hover hits (a sample, a layer, a bare
// position) is each viewer's own affair — see
// docs/adr/0001-crosshair-variants-stay-separate.md. The rig only
// builds, shows at a pixel, and hides.

/** halo keeping readouts legible over curves and soil fills. Canvas is
    the color-scheme-aware page background system color, so the halo
    stays a backdrop on dark pages too; hosts that declare no
    color-scheme resolve it white, the old behavior. Inline style, not
    attr: presentation attributes don't reliably parse system colors.
    The default weight suits crosshair readouts — in-plot labels pass a
    lighter strokeWidth via selection.call(haloText, w) */
export const haloText = (text: AnySelection<SVGTextElement>, strokeWidth = 1.5) =>
  text.style("stroke", "Canvas").attr("stroke-width", strokeWidth).attr("paint-order", "stroke");

export interface FocusRig {
  /** the group; callers append their own extra readouts to it */
  focus: AnySelection<SVGGElement>;
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
    /** the rule's right edge; a thunk is re-read on every show — pass
        one when the plot width can change after setup (the profile's
        spacing toggle) */
    ruleX2: number | (() => number);
    /** append the readout into this svg instead of the focus group — a
        pinned overlay keeps the value at the viewport edge while a wide
        chart scrolls under it. Same pixel coordinates as the chart svg */
    readoutHost?: AnySelection<SVGSVGElement>;
  },
): FocusRig {
  const ruleX2Of = typeof ruleX2 === "function" ? ruleX2 : () => ruleX2;

  const focus = svg.append("g").attr("display", "none").attr("pointer-events", "none");

  const rule = focus
    .append("line")
    .attr("x1", marginLeft)
    .attr("x2", ruleX2Of())
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
    readout,
    show: (ym) => {
      rule.attr("x2", ruleX2Of()); // live width, like the zoom band
      groups.forEach((g) => g.attr("display", null).attr("transform", `translate(0,${ym})`));
    },
    hide: () => groups.forEach((g) => g.attr("display", "none")),
  };
}
