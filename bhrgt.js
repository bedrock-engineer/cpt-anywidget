import * as d3 from "https://esm.sh/d3@7";

// matplotlib-style hatch chars (from brodata's BRO lithology table) as 6x6
// SVG pattern tiles — a second visual channel beyond the band colour
const HATCH_STROKE = `stroke="rgba(0,0,0,0.32)" stroke-width="0.8"`;
const HATCH_SHAPE = {
  "-": `<path d="M0,3 L6,3" ${HATCH_STROKE}/>`,
  "/": `<path d="M0,6 L6,0" ${HATCH_STROKE}/>`,
  "\\": `<path d="M0,0 L6,6" ${HATCH_STROKE}/>`,
  "|": `<path d="M3,0 L3,6" ${HATCH_STROKE}/>`,
  ".": `<circle cx="3" cy="3" r="0.9" fill="rgba(0,0,0,0.32)"/>`,
  o: `<circle cx="3" cy="3" r="1.4" fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="0.7"/>`,
};

export default {
  /** @param {{ model: DOMWidgetModel, el: HTMLElement }} context */
  render({ model, el }) {
    // [{top, bottom, label, bands: [{x1, x2, color, hatch?}]}] — top/bottom
    // in the current vertical coordinate, band x proportional in [0, 1]
    const layers = model.get("layers") ?? [];

    // only the axis label/format depends on this; direction follows the
    // layer order — first layer renders at the top either way
    const verticalKey = model.get("verticalKey") || "depth";

    // optional {verticalKey: [min, max]} override for the vertical axis
    const axisLimits = model.get("axisLimits") ?? {};

    // horizontal reference lines, e.g. groundwater — same contract as CPT:
    // {at, label, color?, dash?, position?: left|center|right, offset?: [dx, dy]}
    const annotations = model.get("annotations") ?? [];

    const width = model.get("width") || 220;
    const height = model.get("height") || 800;

    const marginLeft = 50;
    const marginRight = 20;
    const marginTop = 24;
    const marginBottom = 10;

    const x = d3
      .scaleLinear()
      .domain([0, 1])
      .range([marginLeft, width - marginRight]);

    const first = layers[0];
    const last = layers[layers.length - 1];

    const y = d3
      .scaleLinear()
      .domain(axisLimits[verticalKey] ?? [first?.top ?? 0, last?.bottom ?? 1])
      .range([marginTop, height - marginBottom]);

    // explicit limits are honored exactly; the data-driven fallback is niced
    if (!axisLimits[verticalKey]) {
      y.nice();
    }

    const yAxis = (g, y1) =>
      g
        .attr("transform", `translate(${marginLeft},0)`)
        .call(d3.axisLeft(y1).ticks(height / 60));

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("width", width)
      .attr("height", height)
      // user-select suppresses text selection during drags/brushes; the
      // -webkit- prefix is still required in Safari
      .attr(
        "style",
        "max-width: 100%; height: auto; user-select: none; -webkit-user-select: none;",
      );

    // unique per widget instance: two widgets on one page must not share ids
    const uid = crypto.randomUUID();
    const clipId = `bhrgt-clip-${uid}`;
    svg
      .append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("x", marginLeft)
      .attr("y", marginTop)
      .attr("width", width - marginLeft - marginRight)
      .attr("height", height - marginTop - marginBottom);

    // one <pattern> def per hatch char actually used by the data
    const usedHatches = [
      ...new Set(layers.flatMap((l) => l.bands.map((b) => b.hatch))),
    ].filter(Boolean);
    const hatchId = new Map(
      usedHatches.map((h, i) => [h, `bhrgt-hatch-${uid}-${i}`]),
    );

    svg
      .append("defs")
      .selectAll("pattern")
      .data(usedHatches)
      .join("pattern")
      .attr("id", (h) => hatchId.get(h))
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse")
      .html((h) => HATCH_SHAPE[h]);

    const gy = svg.append("g").call(yAxis, y);

    // static: outside yAxis so zoom redraws don't duplicate it
    svg
      .append("text")
      .attr("x", 0)
      .attr("y", 14)
      .attr("fill", "currentColor")
      .attr("text-anchor", "start")
      .attr("font-weight", "bold")
      .text({ depth: "depth [m]", nap: "NAP [m]" }[verticalKey] ?? verticalKey);

    // flatten the layers into one band array up front — band datums carry
    // their layer, so rendering is two flat joins (colour rects + hatch
    // overlays) and placement stays a function of the current zoomed scale
    const bands = layers.flatMap((layer) =>
      layer.bands.map((b) => ({ ...b, layer })),
    );

    // horizontal extent is static (only y zooms), shared by both joins
    const bandX = (rect) =>
      rect
        .attr("x", (b) => x(b.x1))
        .attr("width", (b) => x(b.x2) - x(b.x1));

    const gLayers = svg.append("g").attr("clip-path", `url(#${clipId})`);

    const bandRect = gLayers
      .selectAll("rect")
      .data(bands)
      .join("rect")
      .call(bandX)
      .attr("fill", (b) => b.color)
      .attr("stroke", "white")
      .attr("stroke-width", 0.5);

    const hatchRect = gLayers
      .selectAll(null)
      .data(bands.filter((b) => b.hatch))
      .join("rect")
      .call(bandX)
      .attr("fill", (b) => `url(#${hatchId.get(b.hatch)})`);

    // white halo keeps names legible over the dark soil bands; visibility
    // is decided per zoom level — labels appear as their layer gets tall
    // enough in pixels
    const soilLabel = gLayers
      .selectAll("text")
      .data(layers)
      .join("text")
      .attr("x", x(0.5))
      .attr("dy", "0.32em")
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "#333")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .attr("paint-order", "stroke")
      .text((l) => l.label ?? "");

    const placeLayers = (y1) => {
      for (const rect of [bandRect, hatchRect]) {
        rect
          .attr("y", (b) => Math.min(y1(b.layer.top), y1(b.layer.bottom)))
          .attr("height", (b) =>
            Math.abs(y1(b.layer.bottom) - y1(b.layer.top)),
          );
      }

      soilLabel
        .attr("y", (l) => (y1(l.top) + y1(l.bottom)) / 2)
        .attr("display", (l) =>
          Math.abs(y1(l.bottom) - y1(l.top)) >= 14 ? null : "none",
        );
    };

    placeLayers(y);

    // named label slots along the line; offset fine-tunes in pixels
    const labelX = {
      left: marginLeft + 6,
      center: (marginLeft + width - marginRight) / 2,
      right: width - marginRight - 6,
    };
    const labelAnchor = { left: "start", center: "middle", right: "end" };

    const annotation = svg
      .append("g")
      .attr("clip-path", `url(#${clipId})`)
      .selectAll("g")
      .data(annotations)
      .join("g");

    annotation
      .append("line")
      .attr("x1", marginLeft)
      .attr("x2", width - marginRight)
      .attr("stroke", (d) => d.color ?? "currentColor")
      .attr("stroke-dasharray", (d) => d.dash ?? "4 3");

    annotation
      .append("text")
      .attr("x", (d) => labelX[d.position ?? "right"] + (d.offset?.[0] ?? 0))
      .attr("y", (d) => -4 + (d.offset?.[1] ?? 0))
      .attr("text-anchor", (d) => labelAnchor[d.position ?? "right"])
      .attr("font-size", 11)
      .attr("fill", (d) => d.color ?? "currentColor")
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .attr("paint-order", "stroke")
      .text((d) => d.label ?? "");

    const placeAnnotations = (y1) =>
      annotation.attr("transform", (d) => `translate(0,${y1(d.at)})`);

    placeAnnotations(y);

    // signed for NAP so values near the datum read unambiguously
    const formatVertical = d3.format(verticalKey === "nap" ? "+.2f" : ".2f");

    // crosshair at the hovered elevation: a rule across the plot, the
    // vertical value on the axis, and the hovered layer's soil name
    const focus = svg.append("g").attr("display", "none");

    focus
      .append("line")
      .attr("x1", marginLeft)
      .attr("x2", width - marginRight)
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3);

    const verticalReadout = focus
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

    const layerReadout = focus
      .append("text")
      .attr("x", width - marginRight - 6)
      .attr("y", -6)
      .attr("text-anchor", "end")
      .attr("font-size", 12)
      .attr("fill", "#333")
      .attr("stroke", "white")
      .attr("stroke-width", 4)
      .attr("paint-order", "stroke");

    let zy = y; // the currently zoomed vertical scale

    // bisect matching the layer direction: depth tops ascend, nap tops
    // descend; the candidate is the last layer starting at or above the
    // value, then containment rejects values past its bottom (gaps, ends)
    const bisectTop =
      layers.length < 2 || layers[0].top <= layers[1].top
        ? d3.bisector((l) => l.top).right
        : d3.bisector((l, v) => v - l.top).right;

    const layerAt = (value) => {
      const l = layers[bisectTop(layers, value) - 1];
      return l &&
        value >= Math.min(l.top, l.bottom) &&
        value <= Math.max(l.top, l.bottom)
        ? l
        : undefined;
    };

    function pointermoved(event) {
      const [, ym] = d3.pointer(event);
      const value = zy.invert(ym);
      const layer = layerAt(value);

      if (!layer) {
        focus.attr("display", "none");
        return;
      }

      focus.attr("display", null).attr("transform", `translate(0,${ym})`);

      verticalReadout.text(`${formatVertical(value)} m`);
      layerReadout.text(layer.label ?? "");
    }

    svg
      .on("pointerenter pointermove", pointermoved)
      .on("pointerleave", () => focus.attr("display", "none"));

    // Brushing
    const brush = d3
      .brushY()
      // only brush with shift key down
      .keyModifiers(false)
      .filter((event) => event.shiftKey)
      .extent([
        [marginLeft, marginTop], // top-left
        [width - marginRight, height - marginBottom], // bottom-right
      ])
      .on("end", brushEnded);

    function brushEnded(event) {
      if (event.selection == null) {
        return;
      }

      const [p0, p1] = event.selection;

      const selectedDomain = [zy.invert(p0), zy.invert(p1)]; // account for current zoom transform

      const [zp0, zp1] = [y(selectedDomain[0]), y(selectedDomain[1])];

      const newHeight = zp1 - zp0;
      const k = (height - marginBottom - marginTop) / newHeight;

      const z = d3.zoomIdentity
        .translate(0, marginTop)
        .scale(k)
        .translate(0, -zp0);

      svg.transition().duration(750).call(zoom.transform, z);

      d3.select(this).call(brush.move, null); // clear brush rect
    }

    svg.append("g").call(brush);

    function zoomed({ transform }) {
      zy = transform.rescaleY(y);

      gy.call(yAxis, zy);
      placeLayers(zy);
      placeAnnotations(zy);
    }

    const zoom = d3
      .zoom()
      .scaleExtent([1, 16])
      .filter(
        (event) => !event.button && (event.type === "wheel" || !event.shiftKey),
      )
      .extent([
        [marginLeft, marginTop], // top-left
        [width - marginRight, height - marginBottom], // bottom-right
      ])
      .translateExtent([
        [-Infinity, marginTop],
        [Infinity, height - marginBottom],
      ])
      .on("zoom", zoomed);

    // double-click resets with an animated transition instead of zooming in
    svg
      .call(zoom)
      .on("dblclick.zoom", null)
      .on("dblclick", () =>
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity),
      );
  },
};
