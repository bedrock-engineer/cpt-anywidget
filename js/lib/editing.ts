import * as d3 from "./d3";
import { assignClass, dragBoundary, merge, splitAt } from "./layer-edits";
import { placeLayerColumn } from "./layers";
import { pieAngles, wedgeAt } from "./pie-menu";
import type { LayerColumn } from "./layers";
import type { AnySelection, Layer, Placer, SoilClass, VerticalScale } from "./types";

interface EditableColumn {
  model: {
    set(key: "editedLayers", value: Layer[]): void;
    save_changes(): void;
  };
  el: HTMLElement;
  signal: AbortSignal;
  layersG: AnySelection<SVGGElement>;
  handlesG: AnySelection<SVGGElement>;
  editedLayers: Layer[];
  soilClasses: SoilClass[];
  classLabel: Map<string, string>;
  columnWidth: number;
  layerColumn: LayerColumn;
  currentY: () => VerticalScale;
}

// the manually editable layer column: drag a boundary to move it,
// double-click a layer to split it there, option-click a boundary to
// merge (the upper layer wins), press a layer and drag toward a wedge
// to pick its class from the soil-class pie (release commits; a
// dead-zone release keeps the pie open for click-to-pick). The edit
// rules live in layer-edits.ts as pure operations; this module is the
// gesture adapter: it translates pointer events into operations, swaps
// in the returned stack when the reference changed (rebinding the
// index-keyed joins), and syncs copies back through the model.
// Returns the handle placer for the zoom loop — layer-rect placement
// rides the caller's shared column placer. currentY() returns the
// live (zoomed) scale
export function editableColumn({
  model,
  el,
  signal,
  layersG,
  handlesG,
  editedLayers,
  soilClasses,
  classLabel,
  columnWidth,
  layerColumn,
  currentY,
}: EditableColumn): Placer {
  // the current edited stack. Operations replace it wholesale; the
  // joins key by index and placement reads bound datums, so a rebind
  // after each accepted operation keeps everything reading fresh
  let layers = editedLayers;

  const syncEditedLayers = () => {
    model.set(
      "editedLayers",
      layers.map((l) => ({ ...l })),
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

  const reflectAltKey = (event: Event) => {
    altHeld = event.type === "blur" ? false : (event as KeyboardEvent).altKey;
    handlesG.selectAll("rect.handle").attr("cursor", handleCursor());
  };

  for (const type of ["keydown", "keyup", "blur"]) {
    window.addEventListener(type, reflectAltKey, { signal });
  }

  let dragChanged = false;

  const dragHandler = d3
    .drag<SVGRectElement, number>()
    .filter((event) => !event.altKey) // option-click is the merge gesture, not a drag
    // anchor the gesture to the boundary value, so grabbing the strip
    // slightly off-center doesn't make the boundary jump
    .subject((event, i) => ({
      x: event.x,
      y: currentY()(layers[i].bottom),
    }))
    .on("drag", (event, i) => {
      const next = dragBoundary(layers, i, currentY().invert(event.y));
      if (next === layers) {
        return; // clamped back to where it was
      }

      layers = next;
      dragChanged = true;

      // same-length rebind: the index join reuses every node, only the
      // datums (and the boundary labels reading them) come out fresh
      layersG.call(layerColumn, layers);
      placeEditColumn(currentY());
    })
    .on("end", () => {
      if (dragChanged) {
        dragChanged = false;
        syncEditedLayers();
      }
    });

  // invisible hit strips over each internal boundary; dragging one
  // moves the shared boundary between the two adjacent layers.
  // re-callable like layerColumn, so structural edits re-join
  const boundaryHandles = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, number>("rect.handle")
      .data(d3.range(layers.length - 1))
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
      .on("click", (event: MouseEvent, i) => {
        if (!event.altKey) {
          return;
        }

        const next = merge(layers, i);
        if (next === layers) {
          return;
        }

        layers = next;
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

  const palette = d3.select(el).append("div").attr("class", "soil-pie").style("display", "none");

  const pieSvg = palette
    .append("svg")
    .attr("viewBox", [-pieSize / 2, -pieSize / 2, pieSize, pieSize].join(","))
    .attr("width", pieSize)
    .attr("height", pieSize);

  // equal slices — the pie layout only carries the angles, and doubles
  // as the angular contract the release gesture hit-tests against.
  // sort(null) keeps palette order; the default sorts by value, which
  // with equal values would scramble that contract
  const { startAngle, endAngle } = pieAngles(soilClasses.length);
  const pieArcs = d3.pie<SoilClass>().value(1).sort(null).startAngle(startAngle).endAngle(endAngle)(
    soilClasses,
  );

  const sliceArc = d3.arc<d3.PieArcDatum<SoilClass>>().innerRadius(pieInner).outerRadius(pieOuter);
  const labelArc = d3
    .arc<d3.PieArcDatum<SoilClass>>()
    .innerRadius((pieInner + pieOuter) / 2)
    .outerRadius((pieInner + pieOuter) / 2);

  const slice = pieSvg
    .selectAll<SVGGElement, d3.PieArcDatum<SoilClass>>("g.slice")
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

  let paletteTimer: number | undefined;

  // press-drag-release state: pointerdown on a layer arms the pie,
  // which opens the moment the pointer moves (drag intent) or after a
  // short hold — snappier than the click fallback, which has to wait
  // out the double-click window before it may show anything
  const holdOpenMs = 150;
  const dragSlop = 4; // movement in px that reads as drag intent

  let press: { x: number; y: number; layer: Layer } | null = null;
  let holdTimer: number | undefined;
  let gestureOpen = false; // the pie is open with the button still down
  let suppressClick = false; // a gesture just ran; swallow its trailing click

  const closePalette = () => {
    clearTimeout(paletteTimer);
    clearTimeout(holdTimer);
    press = null;
    gestureOpen = false;
    palette.style("display", "none");
  };

  const openPalette = (x: number, y: number, layer: Layer) => {
    palette
      .style("display", null)
      .style("left", `${x - pieSize / 2}px`)
      .style("top", `${y - pieSize / 2}px`);

    // the current class stays in place and selectable (a no-op commit)
    // so every layer presents the identical pie — only marked
    slice.classed("active", (d) => d.data.name === layer.class);
    slice.classed("armed", false);

    pieCenter.text(classLabel.get(layer.class!) ?? "—");

    slice.on("click", (_, d) => commitClass(layer, d.data));
  };

  const commitClass = (layer: Layer, picked: SoilClass) => {
    const next = assignClass(layers, layers.indexOf(layer), picked.name);

    if (next !== layers) {
      layers = next;
      updateEditColumn();
      syncEditedLayers();
    }

    closePalette();
  };

  // the wedge on the press→pointer bearing: hit-tested against the
  // pie layout's own arc angles (pie-menu.ts), with the pie's inner
  // hole as the dead zone
  const wedgeUnder = (dx: number, dy: number) => wedgeAt(pieArcs, dx, dy, pieInner);

  // mid-gesture feedback: highlight the armed wedge and preview its
  // label in the center readout (back to the current class in the
  // dead zone)
  const armWedge = (index: number | null, layer: Layer) => {
    slice.classed("armed", (d) => d.index === index);

    pieCenter.text(
      index == null
        ? (classLabel.get(layer.class!) ?? "—")
        : (soilClasses[index].label ?? soilClasses[index].name),
    );
  };

  const openGesture = () => {
    if (!press) {
      return;
    }

    gestureOpen = true;
    openPalette(press.x, press.y, press.layer);
  };

  // window-level so the drag keeps tracking over the pie overlay and
  // outside the svg; only coordinates are read, so shadow-DOM
  // retargeting doesn't matter here
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!press) {
        return;
      }

      const { x, y, layer } = press;
      const [px, py] = d3.pointer(event, el);
      const dx = px - x;
      const dy = py - y;

      if (!gestureOpen) {
        if (Math.hypot(dx, dy) < dragSlop) {
          return;
        }

        clearTimeout(holdTimer);
        openGesture();
      }

      armWedge(wedgeUnder(dx, dy), layer);
    },
    { signal },
  );

  window.addEventListener(
    "pointerup",
    (event) => {
      if (!press) {
        return;
      }

      clearTimeout(holdTimer);

      const { x, y, layer } = press;
      press = null;

      if (!gestureOpen) {
        return; // a quick click — the click fallback takes it from here
      }

      gestureOpen = false;
      suppressClick = true;

      const [px, py] = d3.pointer(event, el);
      const index = wedgeUnder(px - x, py - y);

      if (index != null) {
        commitClass(layer, soilClasses[index]);
      }
      // a dead-zone release keeps the pie open for click-to-pick
    },
    { signal },
  );

  // dismiss on outside interaction or Escape; wheel-zooming would
  // leave the popup floating over the wrong layer. marimo renders the
  // widget in a shadow root, so window-level listeners see event.target
  // retargeted to the shadow host — composedPath pierces the boundary.
  // Capture phase, so pressing a layer rect closes the old pie (and
  // resets the gesture state) before that rect's pointerdown arms the
  // next one
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.composedPath().includes(palette.node()!)) {
        closePalette();
      }
    },
    { capture: true, signal },
  );
  window.addEventListener("wheel", closePalette, { signal });
  window.addEventListener("keydown", (event) => event.key === "Escape" && closePalette(), {
    signal,
  });

  // classify: press a layer to arm the pie under the pointer — hold or
  // drag to open, release over (or beyond) a wedge to commit. A quick
  // click never opens mid-gesture, so it falls back to the delayed
  // open, one double-click beat later, keeping the first click of a
  // split from flashing the popup; detail > 1 marks the second click
  const classifyLayers = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, Layer>("g.layer rect")
      .on("pointerdown", (event: PointerEvent, d) => {
        if (event.button !== 0 || event.altKey) {
          return;
        }

        const [px, py] = d3.pointer(event, el);

        suppressClick = false;
        press = { x: px, y: py, layer: d };
        clearTimeout(holdTimer);
        holdTimer = setTimeout(openGesture, holdOpenMs);
      })
      .on("click", (event: MouseEvent, d) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }

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
  const splitLayers = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, Layer>("g.layer rect")
      .attr("cursor", "crosshair")
      .on("dblclick", (event: MouseEvent, d) => {
        // the svg's own dblclick resets the zoom — keep it out of this
        event.stopPropagation();

        // the first click of this gesture scheduled the palette
        closePalette();

        // the column group is only translated in x, so local y is svg y
        const next = splitAt(layers, layers.indexOf(d), currentY().invert(d3.pointer(event)[1]));

        if (next === layers) {
          return; // too thin to split
        }

        layers = next;
        updateEditColumn();
        syncEditedLayers();
      });

  const placeHandles: Placer = (y1) =>
    handlesG
      .selectAll<SVGRectElement, number>("rect.handle")
      .attr("y", (i) => y1(layers[i].bottom) - 4.5);

  // layer placement rides the shared column placer during zoom; drags
  // and structural edits re-place layers and handles together
  const placeEditColumn = (y1: VerticalScale) => {
    placeLayerColumn(layersG, y1);
    placeHandles(y1);
  };

  // full rebuild after a structural edit (split/merge): re-join layers
  // and handles, then re-place everything at the current zoom
  const updateEditColumn = () => {
    layersG.call(layerColumn, layers).call(splitLayers).call(classifyLayers);

    handlesG.call(boundaryHandles);

    placeEditColumn(currentY());
  };

  updateEditColumn();

  return placeHandles;
}
