import type { RenderProps } from "@anywidget/types";
import * as d3 from "./lib/d3";
import { channelDefaults, makeXScale } from "./lib/channels";
import { annotationLayer } from "./lib/annotations";
import {
  makeVerticalScale,
  plotClip,
  verticalAxisTitle,
  yAxisFor,
  yGridFor,
} from "./lib/frame";
import { resolveVertical } from "./lib/vertical";
import { verticalZoom } from "./lib/zoom";
import type {
  Annotation,
  AnySelection,
  AxisLimits,
  ChannelSpec,
  CptData,
  VerticalScale,
  VerticalSpec,
} from "./lib/types";

/** one CPT strip: name, chainage along the profile line (m), tidy columns */
interface ProfileCpt {
  name: string;
  distance: number;
  data: CptData;
}

/** line in profile space: either a polyline through (chainage, vertical)
    points, or per-strip levels drawn flat across each strip's width
    (e.g. the surface level) with sloping connectors between strips —
    absent names bridge across, an explicit null breaks the line */
interface ProfileOverlay {
  points?: [number | null, number | null][];
  levels?: Record<string, number | null>;
  label?: string;
  color?: string;
  dash?: string;
  width?: number;
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

    // strip anchors: fx maps chainage to the strip's center x. True scale
    // is linear in meters, with two escape hatches that keep strips from
    // ever overlapping: CPTs sharing a chainage (crest + toe soundings at
    // one dijkpaal) fan out side by side around the shared anchor, and
    // the svg grows past the requested width (the host div scrolls
    // sideways) whenever the chainage spread or the strip count needs
    // the room
    const n = cpts.length;
    const distances = cpts.map((c) => c.distance);
    const span = distances[n - 1] - distances[0];
    const stripGap = 10;
    const pitch = stripWidth + stripGap;

    // runs of tied chainages; a run's members dodge around its anchor
    const groups: { dist: number; idx: number[] }[] = [];
    distances.forEach((d, i) => {
      const last = groups[groups.length - 1];
      if (last && last.dist === d) {
        last.idx.push(i);
      } else {
        groups.push({ dist: d, idx: [i] });
      }
    });
    const halfExtent = (g: { idx: number[] }) =>
      ((g.idx.length - 1) * pitch) / 2;

    // the px-per-m floor that keeps adjacent runs clear of each other
    let minScale = 0;
    for (let j = 1; j < groups.length; j += 1) {
      const need = halfExtent(groups[j - 1]) + halfExtent(groups[j]) + pitch;
      minScale = Math.max(
        minScale,
        need / (groups[j].dist - groups[j - 1].dist),
      );
    }

    const endPad =
      halfExtent(groups[0]) + halfExtent(groups[groups.length - 1]);
    const chrome = marginLeft + marginRight + stripWidth;
    const svgWidth = Math.max(
      width,
      Math.ceil(chrome + endPad + minScale * span),
      chrome + (n - 1) * pitch,
    );

    const innerLeft = marginLeft + stripWidth / 2;
    const innerRight = svgWidth - marginRight - stripWidth / 2;
    const mid = (innerLeft + innerRight) / 2;

    const anchorX: (d: number) => number =
      span === 0
        ? () => mid
        : d3
            .scaleLinear()
            .domain([distances[0], distances[n - 1]])
            .range([
              innerLeft + halfExtent(groups[0]),
              innerRight - halfExtent(groups[groups.length - 1]),
            ]);

    const trueCenters: number[] = new Array(n);
    for (const g of groups) {
      const a = anchorX(g.dist);
      g.idx.forEach((i, k) => {
        trueCenters[i] = a + (k - (g.idx.length - 1) / 2) * pitch;
      });
    }

    // equal spacing spreads over the requested width like true scale
    // spreads over the profile, only widening its pitch past that when
    // the strips wouldn't fit
    const equalSpan = Math.max(width - chrome, (n - 1) * pitch);
    const equalCenters =
      n === 1
        ? [mid]
        : distances.map((_, i) => innerLeft + (i * equalSpan) / (n - 1));

    let centers = equal ? equalCenters : trueCenters;

    // chainage → px for the profile-space overlays: linear in true scale,
    // piecewise-linear between the strip anchors when equal-spaced — an
    // overlay point between two strips stays between them in both modes.
    // CPTs can share a chainage (crest + toe soundings at one dijkpaal),
    // and a piecewise scale chokes on duplicate domain values, so ties
    // collapse to one domain stop at their centers' mean
    const distToX = (): ((d: number) => number) => {
      const domain: number[] = [];
      const range: number[] = [];
      for (let j = 0; j < n; ) {
        let k = j;
        let sum = 0;
        while (k < n && distances[k] === distances[j]) {
          sum += centers[k];
          k += 1;
        }
        domain.push(distances[j]);
        range.push(sum / (k - j));
        j = k;
      }
      return domain.length >= 2
        ? d3.scaleLinear().domain(domain).range(range)
        : () => mid;
    };
    let distX = distToX();

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

    const formatDistance = d3.format(",.0f");

    // accepts a selection or a transition (the toggle animates the true-
    // scale ticks). True scale draws an honest linear meter axis; when
    // the anchors don't carry distance (equal spacing, or a profile of
    // one tied chainage) the line and ticks would lie about proportion,
    // so it degrades to plain labels — one chainage per tied run,
    // centered under the run, so crest + toe pairs read as one dijkpaal
    const chainageAxis = (gOrT: any) => {
      if (n < 2) {
        return;
      }
      // Transition.selection() unwraps; Selection.selection() is identity
      const sel: AnySelection<SVGGElement> = gOrT.selection();

      if (!equal && span > 0) {
        sel.selectAll("text.chain-label").remove();
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

      sel.selectAll(".tick,.domain").remove();

      const labelX = (gr: { idx: number[] }) =>
        gr.idx.reduce((s, i) => s + centers[i], 0) / gr.idx.length;

      const labels = sel
        .selectAll<SVGTextElement, (typeof groups)[number]>("text.chain-label")
        .data(groups);
      // entering labels place directly; only updates ride the transition
      const merged = labels
        .enter()
        .append("text")
        .attr("class", "chain-label")
        .attr("y", 9)
        .attr("dy", "0.71em")
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "currentColor")
        .attr("x", labelX)
        .text((gr) => formatDistance(gr.dist))
        .merge(labels);
      if (gOrT !== sel) {
        merged.transition(gOrT).attr("x", labelX);
      } else {
        merged.attr("x", labelX);
      }
      labels.exit().remove();
    };

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
    // the strips in (chainage, vertical) coordinates
    const overlayG = svg
      .append("g")
      .attr("clip-path", `url(#${clipId})`)
      .selectAll<SVGGElement, ProfileOverlay>("g")
      .data(overlays)
      .join("g");

    const overlayPath = overlayG
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (o) => o.color ?? "currentColor")
      .attr("stroke-dasharray", (o) => o.dash ?? null)
      .attr("stroke-width", (o) => o.width ?? 1.5);

    const overlayLabel = overlayG
      .append("text")
      .attr("font-size", 11)
      .attr("fill", (o) => o.color ?? "currentColor")
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .attr("paint-order", "stroke")
      .text((o) => o.label ?? "");

    // the overlay's first drawable vertex, anchoring its label
    const firstVertex = (o: ProfileOverlay): [number, number] | null => {
      if (o.levels) {
        const i = cpts.findIndex((c) => o.levels![c.name] != null);
        return i < 0
          ? null
          : [centers[i] - stripWidth / 2, o.levels[cpts[i].name]!];
      }
      const p = (o.points ?? []).find((p) => p[0] != null && p[1] != null);
      return p ? [distX(p[0]!), p[1]!] : null;
    };

    const overlayLine = (o: ProfileOverlay, y1: VerticalScale) => {
      // per-strip levels: flat across each strip's width, consecutive
      // strips joined by a sloping connector. An absent name bridges to
      // the next strip with a value (e.g. a GWL line skipping non-CPTU
      // soundings); an explicit null breaks the line
      if (o.levels) {
        let d = "";
        let connected = false;
        cpts.forEach((c, i) => {
          const v = o.levels![c.name];
          if (v == null) {
            if (v === null) {
              connected = false;
            }
            return;
          }
          const left = centers[i] - stripWidth / 2;
          d += `${connected ? "L" : "M"}${left},${y1(v)}H${left + stripWidth}`;
          connected = true;
        });
        return d || null;
      }

      return d3
        .line<[number | null, number | null]>()
        .defined((p) => p[0] != null && p[1] != null)
        .x((p) => distX(p[0]!))
        .y((p) => y1(p[1]!))(o.points ?? []);
    };

    const labelX = (o: ProfileOverlay) => {
      const p = firstVertex(o);
      return p ? p[0] + 4 : 0;
    };

    const placeOverlays = (
      y1: VerticalScale,
      // any-typed for the same reason as AnySelection: the d3 transition
      // generics fail variance checks at every seam
      t?: d3.Transition<any, any, any, any>,
    ) => {
      const labelY = (o: ProfileOverlay) => {
        const p = firstVertex(o);
        return p ? y1(p[1]) - 5 : 0;
      };

      if (t) {
        overlayPath.transition(t).attr("d", (o) => overlayLine(o, y1));
        overlayLabel.transition(t).attr("x", labelX).attr("y", labelY);
      } else {
        overlayPath.attr("d", (o) => overlayLine(o, y1));
        overlayLabel
          .attr("x", labelX)
          .attr("y", labelY)
          .attr("display", (o) => (firstVertex(o) ? null : "none"));
      }
    };

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
      centers = equal ? equalCenters : trueCenters;
      distX = distToX();

      const transform = (_: ProfileCpt, i: number) =>
        `translate(${centers[i] - stripWidth / 2},0)`;

      if (animate) {
        const t: d3.Transition<any, any, any, any> = svg
          .transition()
          .duration(600);
        strip.transition(t).attr("transform", transform);
        gChain.transition(t).call(chainageAxis as any);
        placeOverlays(zy, t);
      } else {
        strip.attr("transform", transform);
        gChain.call(chainageAxis);
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
