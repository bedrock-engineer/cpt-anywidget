import type { RenderProps } from "@anywidget/types";
import { readCore, renderCore } from "./lib/cpt-core";
import type { CptCoreModel } from "./lib/cpt-core";
import * as d3 from "./lib/d3";

/** the synced traits — the TS mirror of CPTLog's traitlets. The standalone
    log carries exactly the shared chart traits; the CPTViewer's model adds
    the column traits on top */
type CptLogModel = CptCoreModel;

// the standalone CPT log: the shared CPT chart spine (measurement channels
// on the zoomable vertical axis, hover crosshair, reference-line
// annotations, channel-space overlays) with none of the CPTViewer's layer
// columns. The svg is just the plot — no columns widen it past `width`
export default {
  render({ model, el }: RenderProps<CptLogModel>) {
    const core = readCore(model);

    const margin = { left: 70, right: 50, top: 10, bottom: 10 };

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [0, 0, core.width, core.height].join(","))
      .attr("width", core.width)
      .attr("height", core.height)
      .style("max-width", "100%")
      .style("height", "auto")
      // user-select suppresses text selection during zoom brushes
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    const { vz, placers } = renderCore(svg, core, { margin });

    // apply the zoom drive: it runs the initial placement pass, re-places
    // on every zoom, and its brush overlay re-raises itself on hover
    svg.call(vz.placers(placers));
  },
};
