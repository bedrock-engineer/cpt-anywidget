import type { RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { channelDefaults, makeXScale } from "./lib/channels";
import { annotationLayer } from "./lib/annotations";
import { chainageAxisFor } from "./lib/chainage-axis";
import {
  makeVerticalScale,
  plotClip,
  verticalAxisTitle,
  yAxisFor,
  yGridFor,
} from "./lib/frame";
import { profileOverlayLayer } from "./lib/profile-overlays";
import { resolveVertical } from "./lib/vertical";
import { stripLayout } from "./lib/strip-layout";
import { verticalZoom } from "./lib/zoom";
import type {
  Annotation,
  AxisLimits,
  ChannelSpec,
  CptData,
  ProfileOverlay,
  VerticalScale,
  VerticalSpec,
} from "./lib/types";

/** one CPT strip: name, chainage along the profile line (m), tidy columns */
interface ProfileCpt {
  name: string;
  distance: number;
  data: CptData;
}

/** the synced traits — the TS mirror of ProfileViewer's traitlets */
interface ProfileModel {
  cpts: ProfileCpt[];
  verticalKey: string | VerticalSpec;
  axisLimits: AxisLimits;
  channel: string | ChannelSpec;
  overlays: ProfileOverlay[];
  annotations: Annotation[];
  equalSpacing: boolean;
  stripWidth: number;
  selected: string;
  width: number;
  height: number;
}

export default {
  render({
    model,
    el,
    signal,
  }: RenderProps<ProfileModel> & { signal: AbortSignal }) {
    // strips render left-to-right by chainage regardless of input order
    const cpts = [...(model.get("cpts") ?? [])].sort(
      (a, b) => a.distance - b.distance,
    );

    const vert = resolveVertical(model.get("verticalKey"), "nap");
    const axisLimits = model.get("axisLimits") ?? {};
    const annotations = model.get("annotations") ?? [];
    const overlays = model.get("overlays") ?? [];

    // every strip plots the same single channel (qc by default); the
    // spec/defaults contract matches the interpretation widget's
    // channels entries
    const rawChannel = model.get("channel") || "coneResistance";
    const spec =
      typeof rawChannel === "string" ? { key: rawChannel } : rawChannel;
    const merged = { ...channelDefaults[spec.key], ...spec };
    const channelKey = spec.key;
    const channelLabel = merged.label ?? channelKey;
    const channelColor = merged.color ?? d3.schemeTableau10[0];

    let equal = model.get("equalSpacing") ?? false;

    const stripWidth = model.get("stripWidth") || 90;
    const width = model.get("width") || 700;
    const height = model.get("height") || 500;

    const vertOf = (c: ProfileCpt) => c.data[vert.key] ?? [];
    const valuesOf = (c: ProfileCpt) => c.data[channelKey] ?? [];

    const allVert = cpts
      .flatMap(vertOf)
      .filter((v): v is number => v != null);

    // one shared channel scale across every strip, in strip-local px —
    // comparing strips is the point, so their x domains must agree
    const x = makeXScale(
      cpts.flatMap(valuesOf),
      [0, stripWidth],
      axisLimits[channelKey],
    );

    if (!cpts.length || !allVert.length || !x) {
      d3.select(el).append("div").text("no plottable CPT data");
      return;
    }

    const marginLeft = 50;
    const marginRight = 20;
    const marginTop = 28;
    // room under the plot for the per-strip channel axes + chainage axis
    const marginBottom = 62;
    const yBottom = height - marginBottom;

    // vertical direction follows the data order like the other widgets:
    // the first sample renders at the top (the facade sorts elevations
    // descending); the spec's up only breaks the tie when no strip has
    // two placeable samples
    const ordered = cpts
      .map(vertOf)
      .find((v) => v.filter((s) => s != null).length >= 2);
    let descending = vert.up;
    if (ordered) {
      const first = ordered.find((s) => s != null)!;
      const last = [...ordered].reverse().find((s) => s != null)!;
      if (first !== last) {
        descending = first > last;
      }
    }

    const lo = d3.min(allVert)!;
    const hi = d3.max(allVert)!;

    const y = makeVerticalScale(
      descending ? [hi, lo] : [lo, hi],
      [marginTop, yBottom],
      axisLimits[vert.key],
    );

    let zy = y; // the currently zoomed vertical scale

    // the strip anchor geometry: tie-run dodging, svg growth, both
    // spacing modes' center arrays — see lib/strip-layout
    const n = cpts.length;
    const distances = cpts.map((c) => c.distance);

    const layout = stripLayout({
      distances,
      stripWidth,
      stripGap: 10,
      width,
      marginLeft,
      marginRight,
    });
    const { svgWidth } = layout;

    let centers = equal ? layout.equalCenters : layout.trueCenters;
    let distX = layout.distToX(centers);

    // toolbar above the svg; the toggle round-trips through the trait so
    // Python can flip it too
    const toolbar = d3
      .select(el)
      .append("div")
      .style("font", "12px system-ui, sans-serif")
      .style("margin", "0 0 4px 2px");

    const toggle = toolbar.append("label").style("cursor", "pointer");

    const checkbox = toggle
      .append("input")
      .attr("type", "checkbox")
      .style("vertical-align", "-2px")
      .property("checked", equal)
      .on("change", (event: Event) => {
        model.set(
          "equalSpacing",
          (event.currentTarget as HTMLInputElement).checked,
        );
        model.save_changes();
      });

    toggle.append("span").text(" equal spacing");

    // fixed-px svg in a scrolling host: a wide profile scrolls sideways
    // at full height (css max-width scaling would shrink the height too)
    const scroller = d3
      .select(el)
      .append("div")
      .style("max-width", "100%")
      .style("overflow-x", "auto");

    const svg = scroller
      .append("svg")
      .attr("viewBox", [0, 0, svgWidth, height].join(","))
      .attr("width", svgWidth)
      .attr("height", height)
      .style("display", "block")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    const clipId = plotClip(svg, "profile-clip", {
      x: marginLeft,
      y: marginTop,
      width: svgWidth - marginLeft - marginRight,
      height: yBottom - marginTop,
    });

    // strip-local clip: rides along with each strip group's translate,
    // so one clipPath serves every strip
    const stripClipId = plotClip(svg, "strip-clip", {
      x: 0,
      y: marginTop,
      width: stripWidth,
      height: yBottom - marginTop,
    });

    const yAxis = yAxisFor(marginLeft, height);

    // one background grid across the whole profile — the strips share it
    const yGrid = yGridFor({
      x1: marginLeft,
      x2: svgWidth - marginRight,
      height,
    });

    const gGrid = svg.append("g").call(yGrid, y);
    const gy = svg.append("g").call(yAxis, y);

    verticalAxisTitle(svg, vert.label);

    // the per-strip axes all share one scale, so the unit is labeled once,
    // aligned with their tick labels; flush left like the vertical-axis
    // label — end-anchoring against marginLeft would run off the viewBox
    svg
      .append("text")
      .attr("x", 0)
      .attr("y", yBottom + 9)
      .attr("dy", "0.71em")
      .attr("text-anchor", "start")
      .attr("font-size", 10)
      .attr("font-weight", "bold")
      .attr("fill", channelColor)
      .text(merged.unit ? `${channelLabel} [${merged.unit}]` : channelLabel);

    // chainage axis under the strip axes: honest meters in true scale;
    // equal-spaced mode instead ticks each strip anchor with its chainage
    const chainY = yBottom + 32;
    const gChain = svg
      .append("g")
      .attr("transform", `translate(0,${chainY})`);

    // dual-mode: honest meter axis in true scale, per-dijkpaal labels
    // when equal-spaced; see lib/chainage-axis
    const chainageAxis = chainageAxisFor(layout);

    gChain.call(chainageAxis, { equal, centers });

    if (n >= 2) {
      svg
        .append("text")
        .attr("x", 0)
        .attr("y", chainY + 9)
        .attr("dy", "0.71em")
        .attr("text-anchor", "start")
        .attr("font-size", 10)
        .attr("font-weight", "bold")
        .attr("fill", "currentColor")
        .text("distance [m]");
    }

    // one group per strip, translated to its anchor; contents are
    // strip-local. The frame doubles as the hover/click hit area
    const strip = svg
      .selectAll<SVGGElement, ProfileCpt>(null as unknown as string)
      .data(cpts)
      .join("g");

    strip
      .append("rect")
      .attr("class", "frame")
      .attr("x", 0)
      .attr("y", marginTop)
      .attr("width", stripWidth)
      .attr("height", yBottom - marginTop)
      .attr("fill", "transparent");

    strip
      .append("g")
      .attr("transform", `translate(0,${yBottom})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.max(2, stripWidth / 45))
          .tickSizeOuter(0),
      );

    const stripPath = strip
      .append("g")
      .attr("clip-path", `url(#${stripClipId})`)
      .append("path")
      .attr("fill", "none")
      .attr("stroke", channelColor)
      .attr("stroke-width", 1);

    const stripName = strip
      .append("text")
      .attr("class", "name")
      .attr("x", stripWidth / 2)
      .attr("y", marginTop - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text((d) => d.name);

    const tracePath = (c: ProfileCpt, y1: VerticalScale) => {
      const values = valuesOf(c);
      const vertical = vertOf(c);
      return d3
        .line<number | null>()
        .defined((_, i) => values[i] != null && vertical[i] != null)
        .x((_, i) => x(values[i]!))
        .y((_, i) => y1(vertical[i]!))(values);
    };

    const placeTraces = (y1: VerticalScale) =>
      stripPath.attr("d", (d) => tracePath(d, y1));

    placeTraces(y);

    // profile-space overlays (groundwater level, surface line, ...) span
    // the strips in (chainage, vertical) coordinates; see
    // lib/profile-overlays. The thin adapter closes over the live
    // spacing state so call sites match the other placers
    const placeProfileOverlays = profileOverlayLayer(svg, overlays, {
      names: cpts.map((c) => c.name),
      stripWidth,
      clipId,
    });

    const placeOverlays = (
      y1: VerticalScale,
      t?: d3.Transition<any, any, any, any>,
    ) => placeProfileOverlays(y1, { centers, distX }, t);

    placeOverlays(y);

    const placeAnnotations = annotationLayer(svg, annotations, {
      clipId,
      marginLeft,
      marginRight,
      width: svgWidth,
    });

    placeAnnotations(y);

    const applySelection = () => {
      const selected = model.get("selected");
      strip
        .select<SVGRectElement>("rect.frame")
        .attr("stroke", (d) => (d.name === selected ? "currentColor" : "#bbb"))
        .attr("stroke-width", (d) => (d.name === selected ? 1.5 : 1));
      stripName
        .attr("fill", (d) => (d.name === selected ? "currentColor" : "#555"))
        .attr("font-weight", (d) => (d.name === selected ? "bold" : null));
    };

    applySelection();

    // re-anchor the strips for the current spacing mode; animated when
    // the toggle flips so the strips visibly slide to their new anchors
    const placeStrips = (animate: boolean) => {
      centers = equal ? layout.equalCenters : layout.trueCenters;
      distX = layout.distToX(centers);

      const transform = (_: ProfileCpt, i: number) =>
        `translate(${centers[i] - stripWidth / 2},0)`;

      if (animate) {
        const t: d3.Transition<any, any, any, any> = svg
          .transition()
          .duration(600);
        strip.transition(t).attr("transform", transform);
        gChain.transition(t).call(chainageAxis as any, { equal, centers });
        placeOverlays(zy, t);
      } else {
        strip.attr("transform", transform);
        gChain.call(chainageAxis, { equal, centers });
        placeOverlays(zy);
      }
    };

    placeStrips(false);

    // crosshair: a rule across the whole profile with the vertical value
    // on the axis — the shared axis is the comparison tool, so the
    // readout spans strips instead of reading one channel value
    const focus = svg
      .append("g")
      .attr("display", "none")
      .attr("pointer-events", "none");

    focus
      .append("line")
      .attr("x1", marginLeft)
      .attr("x2", svgWidth - marginRight)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3);

    const readout = focus
      .append("text")
      .attr("x", marginLeft - 8)
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .attr("font-size", 12)
      .attr("font-weight", "bold")
      .attr("fill", "currentColor")
      .attr("stroke", "white")
      .attr("stroke-width", 4)
      .attr("paint-order", "stroke");

    // format from the resolved spec: signed for NAP so values near the
    // datum read unambiguously
    const formatVertical = d3.format(vert.format);

    const stripIndexAt = (px: number) => {
      const i = centers.findIndex((c) => Math.abs(px - c) <= stripWidth / 2);
      return i === -1 ? null : i;
    };

    svg.on("pointerenter pointermove", (event: PointerEvent) => {
      const [px, py] = d3.pointer(event);
      const inPlot =
        py >= marginTop &&
        py <= yBottom &&
        px >= marginLeft &&
        px <= svgWidth - marginRight;

      svg.style("cursor", () =>
        inPlot && stripIndexAt(px) != null ? "pointer" : null,
      );

      if (!inPlot) {
        focus.attr("display", "none");
        return;
      }

      focus.attr("display", null).attr("transform", `translate(0,${py})`);
      readout.text(`${formatVertical(zy.invert(py))} m`);
    });

    svg.on("pointerleave", () => {
      focus.attr("display", "none");
      svg.style("cursor", null);
    });

    // strip hits are resolved svg-level by coordinate: the zoom/brush
    // overlay sits on top of the plot, so the strip rects never receive
    // pointer events themselves. The hit band reaches up to the name
    // labels; clicking the selected strip again deselects
    svg.on("click", (event: MouseEvent) => {
      const [px, py] = d3.pointer(event);
      if (py < marginTop - 20 || py > yBottom) {
        return;
      }
      const i = stripIndexAt(px);
      if (i == null) {
        return;
      }
      const name = cpts[i].name;
      model.set("selected", model.get("selected") === name ? "" : name);
      model.save_changes();
    });

    verticalZoom(svg, {
      y,
      width: svgWidth,
      height,
      marginLeft,
      marginRight,
      marginTop,
      marginBottom,
      onZoom: (zy1) => {
        zy = zy1;

        gy.call(yAxis, zy);
        gGrid.call(yGrid, zy);

        placeTraces(zy);
        placeOverlays(zy);
        placeAnnotations(zy);
      },
    });

    const onSelected = () => applySelection();
    const onSpacing = () => {
      equal = model.get("equalSpacing") ?? false;
      checkbox.property("checked", equal);
      placeStrips(true);
    };

    model.on("change:selected", onSelected);
    model.on("change:equalSpacing", onSpacing);
    signal.addEventListener("abort", () => {
      model.off("change:selected", onSelected);
      model.off("change:equalSpacing", onSpacing);
    });
  },
};
