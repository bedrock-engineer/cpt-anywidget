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
  /** @param {{ model: DOMWidgetModel }} context */
  initialize({ model, signal }) {
    // Set up shared state, event handlers, or programmatic exports.
    // Use `signal` (AbortSignal) for cleanup when the widget is destroyed.
  },
  /** @param {{ model: DOMWidgetModel, el: HTMLElement }} context */
  render({ model, el, signal, host }) {
    // Render the widget's view into the `el` HTMLElement.
    // Use `signal` for view cleanup; use `host` to resolve child widgets.

    const cptData = model.get("cptData");

    // which cptData column is the vertical coordinate: "depth" ascends
    // (positive down), "nap" descends (positive up) — rows are sorted by
    // depth either way, so the first sample always renders at the top
    const verticalKey = model.get("verticalKey") || "depth";
    const vertical = cptData[verticalKey] ?? [];

    // optional per-channel [min, max] overrides, keyed like cptData
    // (plus "depth" for the shared depth axis)
    const axisLimits = model.get("axisLimits") ?? {};

    /** horizontal reference lines with labels, e.g. groundwater level:
       {at, label, color?, dash?, position?: left|center|right, offset?: [dx, dy]}
       — "at" is a value in the current vertical coordinate */
    const annotations = model.get("annotations") ?? [];

    // which channels to plot, in stacking order: entries are a cptData key
    // or {key, label?, unit?, color?, side?: "bottom"|"top"} — merged over
    // the built-in defaults, so unknown keys add new plottable channels;
    // empty = all default channels
    const channels = (model.get("channels") ?? []).map((c) =>
      typeof c === "string" ? { key: c } : c,
    );

    // read-only interpretation columns, stacked right of the plot (no x
    // axis): [{label, layers: [{top, bottom, label?, color?}]}]
    const interpretations = model.get("interpretations") ?? [];

    // nearby geotechnical borehole, left of the plot on the shared axis:
    // {label, layers: [{top, bottom, label?, bands: [{x1, x2, color,
    // hatch?}]}]} — band x proportional in [0, 1]; {} hides the column
    const borehole = model.get("borehole") ?? {};
    const boreholeLayers = borehole.layers ?? [];

    // soil-class palette [{name, color, label?}], the single source of
    // truth for layer colors: one class, one color, in every column. The
    // ordinal scale gets an explicit domain — an implicit one would assign
    // colors in data-encounter order, so the same class could render
    // differently across widget instances; unknown covers classless layers
    const soilClasses = model.get("soil_classes") ?? [];

    const classColor = d3
      .scaleOrdinal(
        soilClasses.map((c) => c.name),
        soilClasses.map((c) => c.color),
      )
      .unknown("#ccc");

    const classLabel = new Map(
      soilClasses.map((c) => [c.name, c.label ?? c.name]),
    );

    // manually editable layer column: one flat layer list in the same shape
    // as an interpretation column's layers; edits sync back to Python.
    // Work on copies — mutating the model's own objects in place would make
    // the eventual model.set() look like a no-change and skip the sync
    const editedLayers = (model.get("editedLayers") ?? []).map((l) => ({
      ...l,
    }));

    const width = model.get("width") || 400;
    const height = model.get("height") || 800;

    const marginLeft = 50;
    const marginRight = 50;

    // layer columns (interpretations + edit column) extend the svg beyond
    // the plot width
    const columnWidth = 72;
    const columnGap = 8;
    const columnX = (i) => width + columnGap + i * (columnWidth + columnGap);

    // one descriptor per layer column: the borehole sits left of the plot,
    // read-only interpretation columns right of it, then the editable
    // column; everything downstream (layout, join, placement) is driven by
    // this array
    const columns = [
      ...(boreholeLayers.length
        ? [
            {
              label: borehole.label ?? "",
              layers: boreholeLayers,
              side: "left",
            },
          ]
        : []),
      ...interpretations.map((d) => ({
        label: d.label ?? "",
        layers: d.layers ?? [],
      })),
      ...(editedLayers.length
        ? [
            {
              label: "Edited Interpr.",
              layers: editedLayers,
              editable: true,
              // the empty separator slot sets the editable column apart
              // from the read-only interpretation columns
              gapBefore: true,
            },
          ]
        : []),
    ];

    // slot layout: left-side columns stack outward at negative x, the rest
    // to the right of the plot; a column with gapBefore leaves one slot
    // empty before it
    let slot = 0;
    let leftSlot = 0;
    for (const c of columns) {
      if (c.side === "left") {
        leftSlot += 1;
        c.x = -leftSlot * (columnWidth + columnGap);
      } else {
        if (c.gapBefore) {
          slot += 1;
        }
        c.x = columnX(slot);
        slot += 1;
      }
    }

    const totalWidth = width + slot * (columnWidth + columnGap);

    // left columns extend the viewBox into negative x instead of shifting
    // the plot: every plot coordinate stays put; the extra columnGap keeps
    // the boundary-depth labels (which reach left of the column) visible
    const x0 = leftSlot ? -leftSlot * (columnWidth + columnGap) - columnGap : 0;

    // bottom cpt axes read left-to-right, top axes right-to-left (mirrored),
    // so the two dominant curves (qc and Rf) sit back-to-back
    const rangeLeftToRight = [marginLeft, width - marginRight];
    const rangeRightToLeft = [width - marginRight, marginLeft];

    const makeXScale = (key, range) => {
      const values = (cptData[key] ?? []).filter((v) => v != null);

      if (!values.length) {
        return null;
      }

      const scale = d3.scaleLinear().range(range);
      const limits = axisLimits[key];

      // explicit limits are honored exactly; the data-driven fallback is niced
      return limits
        ? scale.domain(limits)
        : scale.domain([Math.min(0, d3.min(values)), d3.max(values)]).nice();
    };

    // built-in display defaults for the common BRO channels; a channels
    // entry overrides these per key, side defaults to "bottom"
    // prettier-ignore
    const channelDefaults = {
      coneResistance: { label: "qc",   unit: "MPa", color: "steelblue" },
      localFriction:  { label: "fs",   unit: "MPa", color: "#e15759" },
      porePressureU1: { label: "u1",   unit: "MPa", color: "#af7aa1" },
      porePressureU2: { label: "u2",   unit: "MPa", color: "#76b7b2" },
      frictionRatio:  { label: "Rf",   unit: "%",   color: "#59a14f", side: "top" },
      inclination:    { label: "incl", unit: "°",   color: "#9c755f", side: "top" },
    };

    const requested = channels.length
      ? channels
      : Object.keys(channelDefaults).map((key) => ({ key }));

    const series = requested
      .map((c, i) => {
        const merged = { side: "bottom", ...channelDefaults[c.key], ...c };

        return {
          ...merged,
          label: merged.label ?? c.key,
          color: merged.color ?? d3.schemeTableau10[i % 10],
          x: makeXScale(
            c.key,
            merged.side === "top" ? rangeRightToLeft : rangeLeftToRight,
          ),
        };
      })
      .filter((s) => s.x);

    for (const s of series) {
      s.values = cptData[s.key];
    }

    // one slot per x-axis, stacked outward from the plot edge
    const axisSlot = 30;
    const bottomSeries = series.filter((s) => s.side === "bottom");
    const topSeries = series.filter((s) => s.side === "top");
    const marginTop = 24 + axisSlot * topSeries.length;
    const marginBottom = 10 + axisSlot * bottomSeries.length;

    const y = d3
      .scaleLinear()
      .domain(
        axisLimits[verticalKey] ?? [vertical[0], vertical[vertical.length - 1]],
      )
      .range([marginTop, height - marginBottom]);

    if (!axisLimits[verticalKey]) {
      y.nice();
    }

    let zy = y; // the currently zoomed depth scale

    const xAxis = (g, s, slotY) =>
      g
        .attr("transform", `translate(0,${slotY})`)
        .call(
          (s.side === "bottom" ? d3.axisBottom : d3.axisTop)(s.x).ticks(
            width / 100,
          ),
        )
        .call((g) => g.selectAll("text").attr("fill", s.color))
        .call((g) => g.selectAll("line").attr("stroke", s.color))
        .call((g) => g.select(".domain").attr("stroke", s.color))
        .call((g) =>
          g
            .append("text")
            .attr(
              "x",
              s.side === "bottom" ? marginLeft - 8 : width - marginRight + 8,
            )
            .attr("dy", "0.32em")
            .attr("fill", s.color)
            .attr("text-anchor", s.side === "bottom" ? "end" : "start")
            .attr("font-weight", "bold")
            .text(s.unit ? `${s.label} [${s.unit}]` : s.label),
        );

    // vertical gridlines follow the innermost bottom axis (qc by default)
    const gridX = bottomSeries[0]?.x ?? topSeries[0]?.x;

    const xGrid = (g) =>
      g
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.1)
        .selectAll("line")
        .data(gridX ? gridX.ticks(width / 100) : [])
        .join("line")
        .attr("x1", (d) => 0.5 + gridX(d))
        .attr("x2", (d) => 0.5 + gridX(d))
        .attr("y1", marginTop)
        .attr("y2", height - marginBottom);

    const yAxis = (g, y1) =>
      g
        .attr("transform", `translate(${marginLeft},0)`)
        .call(d3.axisLeft(y1).ticks(height / 60));

    const yGrid = (g, y1) =>
      g
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.1)
        .selectAll("line")
        .data(y1.ticks(height / 60))
        .join("line")
        .attr("x1", marginLeft)
        .attr("x2", totalWidth)
        .attr("y1", (d) => 0.5 + y1(d))
        .attr("y2", (d) => 0.5 + y1(d));

    const svg = d3
      .select(el)
      .append("svg")
      .attr("viewBox", [x0, 0, totalWidth - x0, height])
      .attr("width", totalWidth - x0)
      .attr("height", height)
      .style("max-width", "100%")
      .style("height", "auto")
      // user-select suppresses text selection during drags/brushes;
      .style("user-select", "none")
      .style("-webkit-user-select", "none"); // still required in Safari

    // unique per widget instance: two widgets on one page must not share ids
    const clipId = `plot-clip-${crypto.randomUUID()}`;
    svg
      .append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("x", marginLeft)
      .attr("y", marginTop)
      .attr("width", width - marginLeft - marginRight)
      .attr("height", height - marginTop - marginBottom);

    const gGrid = svg.append("g").call(yGrid, y);

    svg.append("g").call(xGrid);

    bottomSeries.forEach((s, i) =>
      svg.append("g").call(xAxis, s, height - marginBottom + axisSlot * i),
    );

    topSeries.forEach((s, i) =>
      svg.append("g").call(xAxis, s, marginTop - axisSlot * i),
    );

    const gy = svg.append("g").call(yAxis, y);

    // outside yAxis so zoom redraws don't duplicate it
    const yLabel = svg
      .append("text")
      .attr("x", 0)
      .attr("y", 14)
      .attr("fill", "currentColor")
      .attr("text-anchor", "start")
      .attr("font-weight", "bold")
      .text({ depth: "depth [m]", nap: "NAP [m]" }[verticalKey] ?? verticalKey);

    const lineFor = (s, y1) =>
      d3
        .line()
        .defined((_, i) => s.values[i] != null && vertical[i] != null)
        .x((_, i) => s.x(s.values[i]))
        .y((_, i) => y1(vertical[i]))(vertical);

    for (const s of series) {
      s.path = svg
        .append("path")
        .attr("clip-path", `url(#${clipId})`)
        .attr("d", lineFor(s, y))
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 1);
    }

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

    // a layer column: rects + centered labels on the shared vertical scale,
    // no x axis — used by the interpretation columns and the edit column.
    // works in column-local coordinates on a (possibly multi-node) column
    // selection; layers is an array or an accessor of the column datum.
    // re-callable: the keyed join adds/removes nodes in place, so the edit
    // column can .call() it again after structural edits (split/merge)
    const layerColumn = (parent, layers) => {
      const labelMargin = 14; // space for depth labels on boundary lines

      const layerGroup = parent
        .selectAll("g.layer")
        .data(layers)
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
          d.bands ? "" : (d.label ?? classLabel.get(d.class) ?? d.class ?? ""),
        );

      // banded layers get their (long) soil name as a native tooltip
      // instead of an overflowing label
      layerGroup.select("title").text((d) => (d.bands ? (d.label ?? "") : ""));

      // soil-composition bands: proportional x in [0, 1] across the fill
      // area; hatch overlays are a sibling join so a band can carry both a
      // colour and a pattern. band datums copy their layer's extent so
      // vertical placement needs no parent lookup
      const bandData = (d) =>
        (d.bands ?? []).map((b) => ({ ...b, top: d.top, bottom: d.bottom }));

      const bandX = (rect) =>
        rect
          .attr("x", (b) => labelMargin + b.x1 * (columnWidth - labelMargin))
          .attr("width", (b) => (b.x2 - b.x1) * (columnWidth - labelMargin));

      layerGroup
        .selectAll("rect.band")
        .data(bandData)
        .join("rect")
        .attr("class", "band")
        .call(bandX)
        .attr("fill", (b) => b.color)
        .attr("stroke", "white")
        .attr("stroke-width", 0.5);

      layerGroup
        .selectAll("rect.hatch")
        .data((d) => bandData(d).filter((b) => b.hatch))
        .join("rect")
        .attr("class", "hatch")
        .call(bandX)
        .attr("fill", (b) => `url(#${hatchId.get(b.hatch)})`);
    };

    // placement re-selects instead of closing over the join, so it stays
    // valid across re-joins; a function of the current (zoomed) scale
    const placeLayerColumn = (parent, y1) => {
      const layerGroup = parent.selectAll("g.layer");

      layerGroup
        .select("rect")
        .attr("y", (d) => Math.min(y1(d.top), y1(d.bottom)))
        .attr("height", (d) => Math.abs(y1(d.bottom) - y1(d.top)));

      // band datums carry their layer's extent, so the same placement rule
      // applies without a parent lookup
      layerGroup
        .selectAll("rect.band, rect.hatch")
        .attr("y", (d) => Math.min(y1(d.top), y1(d.bottom)))
        .attr("height", (d) => Math.abs(y1(d.bottom) - y1(d.top)));

      layerGroup
        .select("text.soil-label")
        .attr("y", (d) => (y1(d.top) + y1(d.bottom)) / 2);

      layerGroup
        .select("text.top-depth")
        .attr("y", (d) => y1(d.top))
        .text((d) => d.top.toFixed(1));
    };

    // headers sit above the clip region so they don't scroll with zoom;
    // appended to the column group, so x is column-local
    const columnHeader = (column, label) =>
      column
        .append("text")
        .attr("x", columnWidth / 2)
        .attr("y", marginTop - 8)
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .attr("font-weight", "bold")
        .attr("fill", "currentColor")
        .text(label);

    // column-local coordinates: the clip rides along with each column
    // group's horizontal translate, so one clipPath serves every column;
    // it reaches into the gap so boundary depth labels aren't cut off
    const columnClipId = `column-clip-${crypto.randomUUID()}`;

    svg
      .append("clipPath")
      .attr("id", columnClipId)
      .append("rect")
      .attr("x", -columnGap)
      .attr("y", marginTop)
      .attr("width", columnWidth + columnGap)
      .attr("height", height - marginTop - marginBottom);

    // one <pattern> def per hatch char used by any column's bands
    const usedHatches = [
      ...new Set(
        columns.flatMap((c) =>
          c.layers.flatMap((l) => (l.bands ?? []).map((b) => b.hatch)),
        ),
      ),
    ].filter(Boolean);

    const hatchUid = crypto.randomUUID();
    const hatchId = new Map(
      usedHatches.map((h, i) => [h, `hatch-${hatchUid}-${i}`]),
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

    // one group per column, translated to its slot: the header first,
    // then a clipped body holding the layers. The editable column is just
    // another datum here — its extra machinery hangs off the same nodes
    const column = svg
      .selectAll(null)
      .data(columns)
      .join("g")
      .attr("transform", (d) => `translate(${d.x},0)`)
      .call(columnHeader, (d) => d.label);

    const columnBody = column
      .append("g")
      .attr("clip-path", `url(#${columnClipId})`);

    const columnLayers = columnBody
      .append("g")
      .call(layerColumn, (d) => d.layers);

    const columnPlacers = [(y1) => placeLayerColumn(columnLayers, y1)];

    if (editedLayers.length) {
      // the editable column already exists in the columns join — pick its
      // nodes out by datum. Handles go in a sibling group of the layers so
      // re-joined layer rects can never paint over the handles and steal
      // their pointer events
      const layersG = columnLayers.filter((d) => d.editable);
      const handlesG = columnBody.filter((d) => d.editable).append("g");

      // in vertical-coordinate units (m); keeps a layer from collapsing
      const minThickness = 0.05;

      const syncEditedLayers = () => {
        model.set(
          "editedLayers",
          editedLayers.map((l) => ({ ...l })),
        );
        model.save_changes();
      };

      // merge affordance: while alt/option is held the boundary strips read
      // as clickable instead of draggable. window-level listeners because
      // the svg only gets key events when focused; blur resets so the
      // cursor can't stick when the window loses focus mid-hold. `signal`
      // detaches them when the widget is destroyed
      let altHeld = false;

      // no built-in cursor means "delete", so the merge cursor is an inline
      // svg trash bin — drawn twice, a white halo under black strokes, so it
      // reads on any layer color. hotspot 9 9 centers it on the pointer;
      // "pointer" is the fallback where svg cursors are unsupported (Safari)
      const binShape =
        '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>';
      const binCursor = `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="white" stroke-width="4.5">${binShape}</g><g stroke="black" stroke-width="2">${binShape}</g></svg>`,
      )}") 9 9, pointer`;

      const handleCursor = () => (altHeld ? binCursor : "ns-resize");

      const reflectAltKey = (event) => {
        altHeld = event.type === "blur" ? false : event.altKey;
        handlesG.selectAll("rect.handle").attr("cursor", handleCursor());
      };

      for (const type of ["keydown", "keyup", "blur"]) {
        window.addEventListener(type, reflectAltKey, { signal });
      }

      const dragHandler = d3
        .drag()
        .filter((event) => !event.altKey) // option-click is the merge gesture, not a drag
        // anchor the gesture to the boundary value, so grabbing the strip
        // slightly off-center doesn't make the boundary jump
        .subject((event, i) => ({
          x: event.x,
          y: zy(editedLayers[i].bottom),
        }))
        .on("drag", (event, i) => {
          const above = editedLayers[i];
          const below = editedLayers[i + 1];
          const lo = Math.min(above.top, below.bottom) + minThickness;
          const hi = Math.max(above.top, below.bottom) - minThickness;
          const value = Math.max(lo, Math.min(hi, zy.invert(event.y)));

          above.bottom = value;
          below.top = value;

          placeEditColumn(zy);
        })
        .on("end", () => {
          syncEditedLayers();
        });

      // invisible hit strips over each internal boundary; dragging one
      // moves the shared boundary between the two adjacent layers.
      // re-callable like layerColumn, so structural edits re-join
      const boundaryHandles = (parent) =>
        parent
          .selectAll("rect.handle")
          .data(d3.range(editedLayers.length - 1))
          .join("rect")
          .attr("class", "handle")
          .attr("x", 0)
          .attr("width", columnWidth)
          .attr("height", 9)
          .attr("fill", "transparent")
          .attr("cursor", handleCursor())
          .call(dragHandler)
          // merge: option-click deletes this boundary; the upper layer
          // absorbs the lower one and keeps its own class
          .on("click", (event, i) => {
            if (!event.altKey) {
              return;
            }

            editedLayers.splice(i, 2, {
              ...editedLayers[i],
              bottom: editedLayers[i + 1].bottom,
            });

            updateEditColumn();
            syncEditedLayers();
          });

      // class-picker pie: an html overlay div holding its own small svg,
      // positioned in el's css-pixel space — the main svg is scaled by
      // max-width, so its coordinates would land wrong. classes sit at
      // fixed angles from palette order (first class centered on 12
      // o'clock), the same directions on every layer, so picks can become
      // muscle memory
      d3.select(el).style("position", "relative");

      const pieOuter = 75;
      const pieInner = 24; // dead-zone hole, doubles as the class readout
      const pieSize = 2 * pieOuter + 4;

      const palette = d3
        .select(el)
        .append("div")
        .attr("class", "soil-pie")
        .style("display", "none");

      const pieSvg = palette
        .append("svg")
        .attr("viewBox", [-pieSize / 2, -pieSize / 2, pieSize, pieSize])
        .attr("width", pieSize)
        .attr("height", pieSize);

      // equal slices — the pie layout only carries the angles. sort(null)
      // keeps palette order; the default sorts by value, which with equal
      // values would scramble the angular contract
      const halfSlice = Math.PI / soilClasses.length;
      const pieArcs = d3
        .pie()
        .value(1)
        .sort(null)
        .startAngle(-halfSlice)
        .endAngle(2 * Math.PI - halfSlice)(soilClasses);

      const sliceArc = d3.arc().innerRadius(pieInner).outerRadius(pieOuter);
      const labelArc = d3
        .arc()
        .innerRadius((pieInner + pieOuter) / 2)
        .outerRadius((pieInner + pieOuter) / 2);

      const slice = pieSvg
        .selectAll("g.slice")
        .data(pieArcs)
        .join("g")
        .attr("class", "slice");

      slice
        .append("path")
        .attr("d", sliceArc)
        .attr("fill", (d) => d.data.color)
        .attr("stroke", "white")
        .attr("stroke-width", 1.5);

      slice
        .append("text")
        .attr("transform", (d) => `translate(${labelArc.centroid(d)})`)
        .attr("text-anchor", "middle")
        .attr("dy", "0.32em")
        .attr("font-size", 10)
        // contrast from perceptual lightness, so any palette override works
        .attr("fill", (d) => (d3.lab(d.data.color).l > 60 ? "#333" : "white"))
        .text((d) => d.data.label ?? d.data.name);

      // white disc under the readout so it stays legible over any layer
      pieSvg
        .append("circle")
        .attr("r", pieInner - 2)
        .attr("fill", "white");

      const pieCenter = pieSvg
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.32em")
        .attr("font-size", 10)
        .attr("fill", "#333");

      let paletteTimer = null;

      const closePalette = () => {
        clearTimeout(paletteTimer);
        palette.style("display", "none");
      };

      const openPalette = (x, y, layer) => {
        palette
          .style("display", null)
          .style("left", `${x - pieSize / 2}px`)
          .style("top", `${y - pieSize / 2}px`);

        // the current class stays in place and selectable (a no-op commit)
        // so every layer presents the identical pie — only marked
        slice.classed("active", (d) => d.data.name === layer.class);

        pieCenter.text(classLabel.get(layer.class) ?? "—");

        slice.on("click", (_, d) => {
          layer.class = d.data.name;
          // drop stale denormalized display props: from here on the class
          // drives both color and label
          delete layer.label;
          delete layer.color;

          updateEditColumn();
          syncEditedLayers();
          closePalette();
        });
      };

      // dismiss on outside interaction or Escape; wheel-zooming would
      // leave the popup floating over the wrong layer. marimo renders the
      // widget in a shadow root, so window-level listeners see event.target
      // retargeted to the shadow host — composedPath pierces the boundary
      window.addEventListener(
        "pointerdown",
        (event) => {
          if (!event.composedPath().includes(palette.node())) {
            closePalette();
          }
        },
        { signal },
      );
      window.addEventListener("wheel", closePalette, { signal });
      window.addEventListener(
        "keydown",
        (event) => event.key === "Escape" && closePalette(),
        { signal },
      );

      // classify: click a layer, pick its class from the popup. the open
      // is delayed one double-click beat so the first click of a split
      // doesn't flash the popup; detail > 1 marks the second click
      const classifyLayers = (parent) =>
        parent.selectAll("g.layer rect").on("click", (event, d) => {
          if (event.detail !== 1) {
            return;
          }

          const [px, py] = d3.pointer(event, el);

          clearTimeout(paletteTimer);
          paletteTimer = setTimeout(() => openPalette(px, py, d), 200);
        });

      // split: double-click inside a layer inserts a boundary at the
      // pointer's depth; both halves keep the layer's class — click either
      // one to reclassify it. re-applied per join so rects entering after
      // an edit pick up the handler
      const splitLayers = (parent) =>
        parent
          .selectAll("g.layer rect")
          .attr("cursor", "crosshair")
          .on("dblclick", (event, d) => {
            // the svg's own dblclick resets the zoom — keep it out of this
            event.stopPropagation();

            // the first click of this gesture scheduled the palette
            closePalette();

            const lo = Math.min(d.top, d.bottom) + minThickness;
            const hi = Math.max(d.top, d.bottom) - minThickness;

            if (lo > hi) {
              return; // too thin to split
            }

            // the column group is only translated in x, so local y is svg y
            const value = Math.max(
              lo,
              Math.min(hi, zy.invert(d3.pointer(event)[1])),
            );

            editedLayers.splice(
              editedLayers.indexOf(d),
              1,
              { ...d, bottom: value },
              { ...d, top: value },
            );

            updateEditColumn();
            syncEditedLayers();
          });

      const placeHandles = (y1) =>
        handlesG
          .selectAll("rect.handle")
          .attr("y", (i) => y1(editedLayers[i].bottom) - 4.5);

      // layer placement rides the shared column placer during zoom; drags
      // and structural edits re-place layers and handles together
      const placeEditColumn = (y1) => {
        placeLayerColumn(layersG, y1);
        placeHandles(y1);
      };

      // full rebuild after a structural edit (split/merge): re-join layers
      // and handles, then re-place everything at the current zoom
      const updateEditColumn = () => {
        layersG
          .call(layerColumn, editedLayers)
          .call(splitLayers)
          .call(classifyLayers);

        handlesG.call(boundaryHandles);

        placeEditColumn(zy);
      };

      updateEditColumn();

      columnPlacers.push(placeHandles);
    }

    const placeColumns = (y1) => columnPlacers.forEach((place) => place(y1));

    placeColumns(y);

    // signed for NAP so values near the datum read unambiguously
    const formatVertical = d3.format(verticalKey === "nap" ? "+.2f" : ".2f");
    const formatValue = d3.format(".2f");

    // crosshair at the hovered elevation: a rule across the plot, the NAP
    // label on the vertical axis, and a dot + readout per series — all in
    // one group translated vertically to the hovered sample
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

    const dots = focus
      .selectAll("circle")
      .data(series)
      .join("circle")
      .attr("r", 2.5)
      .attr("fill", (s) => s.color);

    const readouts = focus
      .selectAll("text.readout")
      .data(series)
      .join("text")
      .attr("class", "readout")
      .attr("x", width - marginRight)
      .attr("y", (_, i) => (i - (series.length - 1) / 2) * 14)
      .attr("dy", "0.32em")
      .attr("text-anchor", "start")
      .attr("font-size", 12)
      .attr("fill", (s) => s.color)
      .attr("stroke", "white")
      .attr("stroke-width", 4)
      .attr("paint-order", "stroke");

    const bisectorDescend = d3.bisector((d, x) => x - d);

    // bisect matching the data direction: depth ascends, nap descends
    const bisectVertical =
      vertical[0] <= vertical[vertical.length - 1]
        ? (value) => d3.bisectCenter(vertical, value)
        : (value) => bisectorDescend.center(vertical, value);

    function pointermoved(event) {
      const [, ym] = d3.pointer(event);
      const i = bisectVertical(zy.invert(ym));

      if (vertical[i] == null) {
        focus.attr("display", "none");
        return;
      }

      focus
        .attr("display", null)
        .attr("transform", `translate(0,${zy(vertical[i])})`);

      verticalReadout.text(`${formatVertical(vertical[i])} m`);

      dots
        .attr("display", (s) => (s.values[i] == null ? "none" : null))
        .attr("cx", (s) => (s.values[i] == null ? 0 : s.x(s.values[i])));

      readouts.text((s) =>
        s.values[i] == null ? "" : `${s.label} ${formatValue(s.values[i])}`,
      );
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

    const gb = svg.append("g").call(brush);

    function zoomed({ transform }) {
      zy = transform.rescaleY(y);

      gy.call(yAxis, zy);
      gGrid.call(yGrid, zy);

      for (const s of series) {
        s.path.attr("d", lineFor(s, zy));
      }

      placeAnnotations(zy);
      placeColumns(zy);
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

    svg.on("keydown", (event) => {
      if (event.key === "Escape") {
        console.log("Escape key pressed");
      }
    });
  },
};
