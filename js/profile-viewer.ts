import type { RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { axisSlot, channelAxis, channelTitle, makeXScale, resolveChannel } from "./lib/channels";
import { annotationLayer } from "./lib/annotations";
import { chainageAxisFor } from "./lib/chainage-axis";
import {
  makeVerticalScale,
  plotClip,
  verticalAxisTitle,
  yAxisFor,
  yAxisRightFor,
  yGridFor,
} from "./lib/frame";
import { focusRig, haloText } from "./lib/focus-rig";
import { minimap } from "./lib/minimap";
import { profileOverlayLayer } from "./lib/profile-overlays";
import { resolveVertical } from "./lib/vertical";
import { stripLayout } from "./lib/strip-layout";
import { verticalZoom } from "./lib/zoom";
import type {
  Annotation,
  AnySelection,
  AxisLimits,
  ChannelSpec,
  CptData,
  Layer,
  ProfileOverlay,
  VerticalScale,
  VerticalSpec,
} from "./lib/types";

/** one CPT strip: name, chainage along the profile line (m), tidy columns */
interface ProfileCpt {
  name: string;
  distance: number;
  data: CptData;
  /** interpreted layers, top/bottom in the vertical coordinate */
  layers?: Layer[];
}

/** the synced traits — the TS mirror of ProfileViewer's traitlets */
interface ProfileModel {
  cpts: ProfileCpt[];
  verticalKey: string | VerticalSpec;
  axisLimits: AxisLimits;
  channels: (string | ChannelSpec)[];
  overlays: ProfileOverlay[];
  annotations: Annotation[];
  equalSpacing: boolean;
  stripWidth: number;
  selected: string;
  width: number;
  height: number;
}

export default {
  render({ model, el, signal: hostSignal }: RenderProps<ProfileModel>) {
    // marimo's anywidget host predates the AFM `signal` prop and passes
    // undefined; synthesize one so abort-based cleanup works everywhere.
    // The returned dispose function is the part every host honors.
    const controller = new AbortController();
    hostSignal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
    const signal = controller.signal;
    // strips render left-to-right by chainage regardless of input order
    const cpts = [...(model.get("cpts") ?? [])].sort((a, b) =>
      d3.ascending(a.distance, b.distance),
    );

    const vert = resolveVertical(model.get("verticalKey"), "nap");
    const axisLimits = model.get("axisLimits") ?? {};
    const annotations = model.get("annotations") ?? [];
    const overlays = model.get("overlays") ?? [];

    const stripWidth = model.get("stripWidth") || 90;
    const width = model.get("width") || 700;
    const height = model.get("height") || 500;

    const vertOf = (c: ProfileCpt) => c.data[vert.key] ?? [];

    const allVert = cpts.flatMap(vertOf).filter((v): v is number => v != null);

    // every strip plots the same channels (qc by default); the
    // spec/defaults contract matches the interpretation widget's
    // channels entries, including the side: a top channel (Rf, incl)
    // runs right-to-left like in the cpt chart, so the same curve never
    // reads mirrored between the two widgets. Each channel gets one
    // scale shared across every strip, in strip-local px — comparing
    // strips is the point, so the x domains must agree per channel.
    // Channels without data drop out
    const requested: (string | ChannelSpec)[] = model.get("channels") ?? [];
    const series = (requested.length ? requested : ["coneResistance"])
      .map((c, i) => {
        const merged = resolveChannel(c, d3.schemeTableau10[i % 10]);
        return {
          ...merged,
          x: makeXScale(
            cpts.flatMap((cpt) => cpt.data[merged.key] ?? []),
            merged.side === "top" ? [stripWidth, 0] : [0, stripWidth],
            axisLimits[merged.key],
          ),
        };
      })
      .filter(
        (s): s is typeof s & { x: NonNullable<(typeof s)["x"]> } =>
          s.x !== null,
      );

    if (!cpts.length || !allVert.length || !series.length) {
      d3.select(el).append("div").text("no plottable CPT data");
      return;
    }

    // 70 fits the widest end-anchored crosshair readout ("-12.50 m",
    // bold 12px) left of the axis — 50 clipped it at the svg edge
    const marginLeft = 70;
    const marginRight = 40; // room for the right vertical axis labels
    // the axes stack per side like the cpt chart: bottom channels below
    // the strips, top channels above them; the strip name labels keep
    // the top band above the top axis stack
    const bottomSeries = series.filter((s) => s.side === "bottom");
    const topSeries = series.filter((s) => s.side === "top");
    const nameBand = 28;
    const marginTop = nameBand + axisSlot * topSeries.length;
    // room under the plot for the bottom channel axes — one slot per
    // channel, stacked in list order — + the chainage axis
    const bottomSlots = Math.max(bottomSeries.length - 1, 0);
    const marginBottom = 62 + axisSlot * bottomSlots;
    const yBottom = height - marginBottom;

    // slot line for one channel axis: bottom channels stack downward
    // from the plot's bottom edge, top channels upward from its top edge
    const slotY = (s: (typeof series)[number]) =>
      s.side === "top"
        ? marginTop - axisSlot * topSeries.indexOf(s)
        : yBottom + axisSlot * bottomSeries.indexOf(s);

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

    // the strip anchor geometry: tie-run dodging, svg growth, both
    // spacing modes' geometries and the active mode — the layout owns
    // the spacing state, consumers read centers()/width()/distX() live
    // and never keep copies; see lib/strip-layout
    const n = cpts.length;
    const distances = cpts.map((c) => c.distance);

    const layout = stripLayout({
      distances,
      stripWidth,
      stripGap: 10,
      width,
      marginLeft,
      marginRight,
    }).equalSpacing(model.get("equalSpacing") ?? false);

    // the plot's right edge in the active spacing mode; a thunk so the
    // grid, the right axis, the zoom band and the hit tests read it live
    const plotRight = () => layout.width() - marginRight;

    // the zoom drive; applied at the end of setup, but currentScale is
    // valid already — the pointer handlers below take it directly. The
    // xExtent thunk is re-read per gesture, so the brush tracks the
    // width across the spacing toggle
    const vz = verticalZoom()
      .scale(y)
      .xExtent(() => [marginLeft, plotRight()]);

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
      .property("checked", layout.equalSpacing())
      .on("change", (event: Event) => {
        model.set(
          "equalSpacing",
          (event.currentTarget as HTMLInputElement).checked,
        );
        model.save_changes();
      });

    toggle.append("span").text(" equal spacing");

    // layer legend, derived from the plotted layers so it can never
    // drift from the backdrops: distinct label/color pairs in first-
    // appearance order (strips left to right, layers top down).
    // Unlabeled layers have nothing to say here and are skipped
    const legendEntries: { label: string; color: string }[] = [];
    const seenLabels = new Set<string>();
    for (const c of cpts) {
      for (const l of c.layers ?? []) {
        if (!l.label || seenLabels.has(l.label)) continue;
        seenLabels.add(l.label);
        legendEntries.push({ label: l.label, color: l.color ?? "#999" });
      }
    }

    if (legendEntries.length) {
      const item = d3
        .select(el)
        .append("div")
        .style("font", "11px system-ui, sans-serif")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("gap", "2px 10px")
        .style("margin", "0 0 4px 2px")
        .selectAll("span.legend-item")
        .data(legendEntries)
        .join("span")
        .attr("class", "legend-item")
        .style("white-space", "nowrap");
      // the swatch matches the backdrop's opacity, so it shows the
      // color as it actually appears in the plot
      item
        .append("span")
        .style("display", "inline-block")
        .style("width", "10px")
        .style("height", "10px")
        .style("margin-right", "4px")
        .style("vertical-align", "-1px")
        .style("background", (e) => e.color);
      item.append("span").text((e) => e.label);
    }

    // overview bar between the toolbar and the scroller; shows only
    // when the profile overflows sideways — see lib/minimap
    const minimapHost = d3.select(el).append("div");

    // fixed-px svg in a scrolling host: a wide profile scrolls sideways
    // at full height (css max-width scaling would shrink the height too).
    // The wrapper anchors the pinned axis overlay over the scroller
    const wrap = d3
      .select(el)
      .append("div")
      .style("position", "relative")
      .style("max-width", "100%");

    const scroller = wrap
      .append("div")
      .style("max-width", "100%")
      .style("overflow-x", "auto");

    const svg = scroller
      .append("svg")
      .attr("viewBox", [0, 0, layout.width(), height].join(","))
      .attr("width", layout.width())
      .attr("height", height)
      .style("display", "block")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    const clipId = plotClip(svg, "profile-clip", {
      x: marginLeft,
      y: marginTop,
      width: layout.width() - marginLeft - marginRight,
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

    // pinned axis overlay: the chart svg keeps its real left axis (a
    // serialized svg stays self-contained), and this fixed copy sits on
    // top of the scroller's left edge so the axis and the readout stay
    // in view while a wide profile scrolls underneath. pointer-events:
    // none lets hover/click/brush through to the chart
    const pinnedLeft = wrap
      .append("svg")
      .attr("width", marginLeft + 1)
      .attr("height", height)
      .style("position", "absolute")
      .style("left", "0")
      .style("top", "0")
      .style("pointer-events", "none");

    const yAxis = yAxisFor(marginLeft, height);
    // right-edge axis (scrolls with the chart, no pinned copy): its x
    // is a thunk reading the live width, so the spacing toggle needs
    // no rebuild (likewise yGrid below)
    const yAxisR = yAxisRightFor(plotRight, height);

    // one background grid across the whole profile — the strips share
    // it; its right edge reads the live width
    const yGrid = yGridFor({
      x1: marginLeft,
      x2: plotRight,
      height,
    });

    // placed by the zoom drive (and the grid by placeStrips too)
    const gGrid = svg.append("g");
    const gy = svg.append("g");
    const gyR = svg.append("g");
    const gyPinned = pinnedLeft.append("g");

    // halo keeps the pinned copy's labels legible over strips scrolling
    // underneath it
    const haloTicks = (g: AnySelection<SVGGElement>) =>
      g.selectAll<SVGTextElement, unknown>("text").call(haloText);

    // every vertical axis in one placer: the two real ones in the chart
    // svg and the pinned viewport-edge copy, so they cannot drift
    const placeAxes = (y1: VerticalScale) => {
      gy.call(yAxis, y1);
      gyR.call(yAxisR, y1);
      haloTicks(gyPinned.call(yAxis, y1));
    };

    verticalAxisTitle(svg, vert.label);
    verticalAxisTitle(pinnedLeft, vert.label);
    pinnedLeft.selectAll<SVGTextElement, unknown>("text").call(haloText);

    // the per-strip axes all share one scale per channel, so each unit
    // is labeled once, aligned with its slot's tick labels; flush left
    // like the vertical-axis label — end-anchoring against marginLeft
    // would run off the viewBox
    svg
      .selectAll("text.channel-label")
      .data(series)
      .join("text")
      .attr("class", "channel-label")
      .attr("x", 0)
      .attr("y", (s) => slotY(s) + (s.side === "top" ? -9 : 9))
      .attr("dy", (s) => (s.side === "top" ? "0em" : "0.71em"))
      .attr("text-anchor", "start")
      .attr("font-size", 10)
      .attr("font-weight", "bold")
      .attr("fill", (s) => s.color)
      .text(channelTitle);

    // chainage axis under the strip axes: honest meters in true scale;
    // equal-spaced mode instead ticks each strip anchor with its chainage
    const chainY = yBottom + axisSlot * bottomSlots + 32;
    const gChain = svg.append("g").attr("transform", `translate(0,${chainY})`);

    // dual-mode: honest meter axis in true scale, per-dijkpaal labels
    // when equal-spaced; reads the layout's live spacing state — see
    // lib/chainage-axis
    const chainageAxis = chainageAxisFor(layout);

    gChain.call(chainageAxis);

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
      .selectAll<SVGGElement, ProfileCpt>("g.strip")
      .data(cpts)
      .join("g")
      .attr("class", "strip");

    // interpreted layers as a full-width backdrop: the classic soil
    // profile — each layer's color fills the strip behind the curves at
    // reduced opacity, so the traces stay legible on top. Appended
    // before the frame so the selection stroke stays on top, clipped
    // like the traces so zoom cannot spill it
    const stripLayer = strip
      .append("g")
      .attr("clip-path", `url(#${stripClipId})`)
      .selectAll<SVGRectElement, Layer>("rect")
      .data((c) => c.layers ?? [])
      .join("rect")
      .attr("x", 0)
      .attr("width", stripWidth)
      .attr("fill", (l) => l.color ?? "#999")
      .attr("fill-opacity", 0.8)
      .style("stroke", "Canvas")
      .attr("stroke-width", 0.5);

    // min/max instead of trusting top < bottom in pixel space: NAP runs
    // upward, so the numerically greater boundary is the higher pixel
    const placeLayers = (y1: VerticalScale) =>
      stripLayer
        .attr("y", (l) => Math.min(y1(l.top), y1(l.bottom)))
        .attr("height", (l) => Math.abs(y1(l.bottom) - y1(l.top)));

    strip
      .append("rect")
      .attr("class", "frame")
      .attr("x", 0)
      .attr("y", marginTop)
      .attr("width", stripWidth)
      .attr("height", yBottom - marginTop)
      .attr("fill", "transparent");

    strip
      .selectAll<SVGGElement, (typeof series)[number]>("g.channel-axis")
      .data(() => series)
      .join("g")
      .attr("class", "channel-axis")
      .attr("transform", (s) => `translate(0,${slotY(s)})`)
      .each(function (s) {
        d3.select(this).call(channelAxis, s, {
          ticks: Math.max(2, stripWidth / 45),
          tickSizeOuter: 0,
        });
      });

    const stripPath = strip
      .append("g")
      .attr("clip-path", `url(#${stripClipId})`)
      .selectAll("path")
      .data((c) => series.map((s) => ({ c, s })))
      .join("path")
      .attr("fill", "none")
      .attr("stroke", ({ s }) => s.color)
      .attr("stroke-width", 1);

    const stripName = strip
      .append("text")
      .attr("class", "name")
      .attr("x", stripWidth / 2)
      .attr("y", nameBand - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .text((d) => d.name);

    const tracePath = (
      c: ProfileCpt,
      s: (typeof series)[number],
      y1: VerticalScale,
    ) => {
      const values = c.data[s.key] ?? [];
      const vertical = vertOf(c);
      return d3
        .line<number | null>()
        .defined((_, i) => values[i] != null && vertical[i] != null)
        .x((_, i) => s.x(values[i]!))
        .y((_, i) => y1(vertical[i]!))(values);
    };

    const placeTraces = (y1: VerticalScale) =>
      stripPath.attr("d", ({ c, s }) => tracePath(c, s, y1));

    // profile-space overlays (groundwater level, surface line, ...) span
    // the strips in (chainage, vertical) coordinates; see
    // lib/profile-overlays. The thin adapter reads the layout's live
    // spacing state so call sites match the other placers
    const placeProfileOverlays = profileOverlayLayer(svg, overlays, {
      names: cpts.map((c) => c.name),
      stripWidth,
      clipId,
    });

    const placeOverlays = (
      y1: VerticalScale,
      t?: d3.Transition<any, any, any, any>,
    ) =>
      placeProfileOverlays(
        y1,
        { centers: layout.centers(), distX: layout.distX() },
        t,
      );

    const placeAnnotations = annotationLayer(svg, annotations, {
      clipId,
      marginLeft,
      marginRight,
      width: () => layout.width(),
    });

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

    const placeMinimap = minimap(minimapHost, scroller.node()!, {
      stripWidth,
      signal,
    });

    // re-anchor the strips for the layout's current spacing mode;
    // animated when the toggle flips so the strips visibly slide to
    // their new anchors. Only the irreducibly-DOM toggle work lives
    // here — the geometry itself comes from the layout. Not a Placer —
    // spacing, not zoom, drives it — so the scale comes in explicitly
    const placeStrips = (animate: boolean, y1: VerticalScale) => {
      const centers = layout.centers();
      const curWidth = layout.width();

      svg
        .select(`#${clipId} rect`)
        .attr("width", curWidth - marginLeft - marginRight);

      const transform = (_: ProfileCpt, i: number) =>
        `translate(${centers[i] - stripWidth / 2},0)`;

      if (animate) {
        const t: d3.Transition<any, any, any, any> = svg
          .transition()
          .duration(500);
        t.attr("width", curWidth).attr(
          "viewBox",
          [0, 0, curWidth, height].join(","),
        );
        strip.transition(t).attr("transform", transform);
        gGrid
          .selectAll("line")
          .transition(t as any)
          .attr("x2", curWidth - marginRight);
        gyR.transition(t).attr("transform", `translate(${curWidth - marginRight},0)`);
        gChain.transition(t).call(chainageAxis);
        placeOverlays(y1, t);
      } else {
        svg
          .attr("width", curWidth)
          .attr("viewBox", [0, 0, curWidth, height].join(","));
        strip.attr("transform", transform);
        gGrid.call(yGrid, y1);
        gyR.call(yAxisR, y1);
        gChain.call(chainageAxis);
        placeOverlays(y1);
      }
      placeAnnotations(y1);
      placeMinimap({ centers, contentWidth: curWidth });
    };

    // crosshair: a rule across the whole profile with the vertical value
    // on the axis — the shared axis is the comparison tool, so the
    // readout spans strips instead of reading one channel value. The
    // rule's x2 is a thunk, re-read on every show, so it tracks the
    // spacing mode's width by itself.
    // the readout renders in the pinned overlay so it stays at the
    // viewport edge with the axis copy; same pixel space, no conversion
    const rig = focusRig(svg, {
      marginLeft,
      ruleX2: plotRight,
      readoutHost: pinnedLeft,
    });

    placeStrips(false, y);

    // format from the resolved spec: signed for NAP so values near the
    // datum read unambiguously
    const formatVertical = d3.format(vert.format);

    const stripIndexAt = (px: number) => {
      const i = layout
        .centers()
        .findIndex((c) => Math.abs(px - c) <= stripWidth / 2);
      return i === -1 ? null : i;
    };

    // hovered-strip value readout: the bare-position rule stays the
    // comparison tool (ADR-0001), but the one strip under the pointer
    // also reads out its channel values at the nearest sample — a
    // single bisect per channel, no per-strip DOM elsewhere
    const formatValue = d3.format(".2f");
    const bisectorDescend = d3.bisector<number, number>((d, x) => x - d);
    const bisectStrip = (vertical: (number | null)[], value: number) =>
      descending
        ? bisectorDescend.center(vertical as number[], value)
        : d3.bisectCenter(vertical as number[], value);

    // the hovered strip's values stack just outside its frame's right
    // edge — beside the curves like the CPT viewer's readouts right of
    // the plot, not over them. Riding the focus group, centered on the
    // rule; near the svg's right edge the stack flips to the frame's
    // left so it never clips away
    const valueGroup = rig.focus.append("g").attr("display", "none");

    const placeStripValues = (si: number | null, py: number) => {
      const zy = vz.currentScale();
      const c = si == null ? null : cpts[si];
      const vertical = c ? vertOf(c) : [];
      const i = c ? bisectStrip(vertical, zy.invert(py)) : 0;
      const vi = vertical[i];
      // only read out when the nearest sample sits on the rule —
      // hovering past a short strip's end must not read its end values
      const entries =
        c && vi != null && Math.abs(zy(vi) - py) <= 8
          ? series
              .map((s) => ({ s, v: c.data[s.key]?.[i] }))
              .filter((e) => e.v != null)
          : [];

      if (si == null || !entries.length) {
        valueGroup.attr("display", "none");
        return;
      }

      const centers = layout.centers();
      const flip = centers[si] + stripWidth / 2 + 76 > layout.width();
      const x = centers[si] + (stripWidth / 2 + 6) * (flip ? -1 : 1);

      valueGroup
        .attr("display", null)
        .selectAll<SVGTextElement, (typeof entries)[number]>("text")
        .data(entries)
        .join("text")
        .attr("x", x)
        .attr("y", (_, i) => (i - (entries.length - 1) / 2) * 14)
        .attr("dy", "0.32em")
        .attr("text-anchor", flip ? "end" : "start")
        .attr("font-size", 12)
        .attr("fill", ({ s }) => s.color)
        .call(haloText)
        .text(({ s, v }) => `${s.label} ${formatValue(v!)}`);
    };

    svg.on("pointerenter pointermove", (event: PointerEvent) => {
      const [px, py] = d3.pointer(event);
      const inPlot =
        py >= marginTop &&
        py <= yBottom &&
        px >= marginLeft &&
        px <= plotRight();

      const si = inPlot ? stripIndexAt(px) : null;
      svg.style("cursor", () => (si != null ? "pointer" : null));

      if (!inPlot) {
        rig.hide();
        return;
      }

      rig.show(py);
      rig.readout.text(`${formatVertical(vz.currentScale().invert(py))} m`);
      placeStripValues(si, py);
    });

    svg.on("pointerleave", () => {
      rig.hide();
      svg.style("cursor", null);
    });

    // strip hits are resolved svg-level by coordinate: the zoom/brush
    // overlay sits on top of the plot, so the strip rects never receive
    // pointer events themselves. The hit band reaches up to the name
    // labels; clicking the selected strip again deselects
    svg.on("click", (event: MouseEvent) => {
      const [px, py] = d3.pointer(event);
      if (py < nameBand - 20 || py > yBottom) {
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

    // apply the zoom drive: it runs the initial placement pass and
    // re-places on every zoom; the grid and right axis read the live
    // width themselves, so no placer cares about the spacing mode
    svg.call(
      vz.placers([
        placeAxes,
        (y1) => gGrid.call(yGrid, y1),
        placeLayers,
        placeTraces,
        placeOverlays,
        placeAnnotations,
      ]),
    );

    const onSelected = () => applySelection();
    const onSpacing = () => {
      layout.equalSpacing(model.get("equalSpacing") ?? false);
      checkbox.property("checked", layout.equalSpacing());
      placeStrips(true, vz.currentScale());
    };

    model.on("change:selected", onSelected);
    model.on("change:equalSpacing", onSpacing);
    signal.addEventListener("abort", () => {
      model.off("change:selected", onSelected);
      model.off("change:equalSpacing", onSpacing);
    });
    return () => controller.abort();
  },
};
