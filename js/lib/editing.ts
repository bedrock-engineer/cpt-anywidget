import * as d3 from "./d3";
import { assignClass, dragBoundary, merge, splitAt } from "./layer-edits";
import { labelMargin, placeLayerColumn } from "./layers";
import { pieAngles, wedgeAt } from "./pie-menu";
import type { LayerColumn } from "./layers";
import type { AnySelection, Layer, Placer, SoilClass, VerticalScale } from "./types";

// the structure lane along the edit column's outer edge, where
// boundary-structure edits (split/merge) live; the caller grows the
// svg by laneExtent when the edit column exists
export const laneGap = 2;
export const laneWidth = 14;
export const laneExtent = laneGap + laneWidth;

interface EditableColumn {
  model: {
    set(key: "editedLayers", value: Layer[]): void;
    save_changes(): void;
  };
  el: HTMLElement;
  signal: AbortSignal;
  layersG: AnySelection<SVGGElement>;
  handlesG: AnySelection<SVGGElement>;
  /** unclipped sibling of the column body for the structure lane */
  laneG: AnySelection<SVGGElement>;
  editedLayers: Layer[];
  soilClasses: SoilClass[];
  classLabel: Map<string, string>;
  columnWidth: number;
  /** pixel extent of the plot area, for the lane's static strip */
  plotTop: number;
  plotBottom: number;
  layerColumn: LayerColumn;
  currentY: () => VerticalScale;
}

// the manually editable layer column. Every edit has its own visible
// zone, so a click means one thing wherever it lands: drag a boundary
// strip to move it; the structure lane beside the column hosts split
// and merge (hover previews the edit, click commits); click a layer
// body to pick its class from the soil-class pie — or press and drag
// toward a wedge as the fast path (release commits; a dead-zone
// release keeps the pie open for click-to-pick). The edit rules live
// in layer-edits.ts as pure operations; this module is the gesture
// adapter: it translates pointer events into operations, swaps in the
// returned stack when the reference changed (rebinding the
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
  laneG,
  editedLayers,
  soilClasses,
  classLabel,
  columnWidth,
  plotTop,
  plotBottom,
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

  let dragChanged = false;

  const dragHandler = d3
    .drag<SVGRectElement, number>()
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
      .join((enter) =>
        enter
          .append("rect")
          .attr("class", "handle")
          .attr("x", 0)
          .attr("width", columnWidth)
          .attr("height", 9)
          .attr("fill", "transparent")
          .attr("cursor", "ns-resize")
          .call(dragHandler),
      );

  // the structure lane: a persistent strip along the column's outer
  // edge hosting the boundary-structure edits, each previewed on hover
  // before a click commits it — near a boundary an × offers to merge
  // it away (upper layer absorbs, keeps its class), anywhere else a
  // dashed insertion line tracks the pointer's depth and a click
  // splits there. Stateless: click re-derives the target, so preview
  // and commit can't disagree
  const laneX = columnWidth + laneGap;
  const snapPx = 6; // pointer-to-boundary distance that reads as "this boundary"

  const laneHit = laneG
    .append("rect")
    .attr("x", laneX)
    .attr("y", plotTop)
    .attr("width", laneWidth)
    .attr("height", plotBottom - plotTop)
    .attr("fill", "#f6f6f6")
    .attr("stroke", "#ddd")
    .attr("cursor", "pointer");

  // previews sit over the hit rect; pointer-events off so they can't
  // steal the hover that placed them
  const laneLine = laneG
    .append("line")
    .attr("x1", labelMargin)
    .attr("x2", laneX + laneWidth)
    .attr("stroke-width", 1.5)
    .attr("pointer-events", "none")
    .attr("display", "none");

  const laneGlyph = laneG
    .append("text")
    .attr("x", laneX + laneWidth / 2)
    .attr("text-anchor", "middle")
    .attr("dy", "0.32em")
    .attr("font-size", 12)
    .attr("font-weight", "bold")
    .attr("pointer-events", "none")
    .attr("display", "none");

  // at: the preview's pixel anchor — the boundary for a merge, the
  // pointer for a split
  type LaneTarget =
    | { kind: "merge"; boundary: number; at: number }
    | { kind: "split"; layer: number; value: number; at: number }
    | null;

  // what the lane offers at pixel py: the nearest internal boundary
  // within snapPx, else the containing layer and the inverted depth
  const laneTarget = (py: number): LaneTarget => {
    const y1 = currentY();

    let best = snapPx;
    let nearest: LaneTarget = null;
    for (let i = 0; i < layers.length - 1; i++) {
      const by = y1(layers[i].bottom);
      if (Math.abs(by - py) < best) {
        best = Math.abs(by - py);
        nearest = { kind: "merge", boundary: i, at: by };
      }
    }
    if (nearest) {
      return nearest;
    }

    const value = y1.invert(py);
    // orientation-agnostic containment (depth: top < bottom, nap: reverse)
    const layer = layers.findIndex((l) => (value - l.top) * (value - l.bottom) <= 0);

    return layer === -1 ? null : { kind: "split", layer, value, at: py };
  };

  const hideLanePreview = () => {
    laneLine.attr("display", "none");
    laneGlyph.attr("display", "none");
  };

  // merge previews the boundary that disappears (solid, alert red);
  // split previews the boundary that appears (dashed, at the pointer)
  const previewLane = (py: number) => {
    const target = laneTarget(py);
    if (!target) {
      hideLanePreview();
      return;
    }

    const merging = target.kind === "merge";
    const color = merging ? "#c0392b" : "#444";

    laneLine
      .attr("display", null)
      .attr("y1", target.at)
      .attr("y2", target.at)
      .attr("stroke", color)
      .attr("stroke-dasharray", merging ? null : "4,3");

    laneGlyph
      .attr("display", null)
      .attr("y", target.at)
      .attr("fill", color)
      .text(merging ? "×" : "+");
  };

  laneHit
    .on("pointermove", (event: PointerEvent) => previewLane(d3.pointer(event)[1]))
    .on("pointerleave", hideLanePreview)
    // rapid successive lane clicks must not reach the svg's dblclick
    // zoom reset
    .on("dblclick", (event: MouseEvent) => event.stopPropagation())
    .on("click", (event: MouseEvent) => {
      closePalette();

      const py = d3.pointer(event)[1];
      const target = laneTarget(py);
      if (!target) {
        return;
      }

      const next =
        target.kind === "merge"
          ? merge(layers, target.boundary)
          : splitAt(layers, target.layer, target.value);

      if (next === layers) {
        return; // too thin to split
      }

      layers = next;
      updateEditColumn();
      syncEditedLayers();
      previewLane(py); // the stack under the pointer just changed
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

  // press-drag-release state: pointerdown on a layer arms the pie,
  // which opens the moment the pointer moves (drag intent); a quick
  // stationary click opens it on release instead
  const dragSlop = 4; // movement in px that reads as drag intent

  let press: { x: number; y: number; layer: Layer } | null = null;
  let gestureOpen = false; // the pie is open with the button still down
  let suppressClick = false; // a gesture just ran; swallow its trailing click

  // the layer the open pie edits and the armed wedge — shared by
  // pointer and keyboard, so arrows pick up from where a drag armed
  let pieFor: Layer | null = null;
  let armedIndex: number | null = null;

  const closePalette = () => {
    press = null;
    gestureOpen = false;
    pieFor = null;
    armedIndex = null;
    palette.style("display", "none");
  };

  const openPalette = (x: number, y: number, layer: Layer) => {
    pieFor = layer;

    palette
      .style("display", null)
      .style("left", `${x - pieSize / 2}px`)
      .style("top", `${y - pieSize / 2}px`);

    // the current class stays in place and selectable (a no-op commit)
    // so every layer presents the identical pie — only marked
    slice.classed("active", (d) => d.data.name === layer.class);
    armWedge(null);
  };

  const commitClass = (picked: SoilClass) => {
    const next = assignClass(layers, layers.indexOf(pieFor!), picked.name);

    if (next !== layers) {
      layers = next;
      updateEditColumn();
      syncEditedLayers();
    }

    closePalette();
  };

  // click-to-pick, bound once: pieFor names the target layer for the
  // pie's whole lifetime
  slice.on("click", (_, d) => commitClass(d.data));

  // the wedge on the press→pointer bearing: hit-tested against the
  // pie layout's own arc angles (pie-menu.ts), with the pie's inner
  // hole as the dead zone
  const wedgeUnder = (dx: number, dy: number) => wedgeAt(pieArcs, dx, dy, pieInner);

  // mid-gesture feedback: highlight the armed wedge and preview its
  // label in the center readout (back to the current class in the
  // dead zone). The armed wedge is also what a release or Enter
  // commits, so preview and commit can't disagree
  const armWedge = (index: number | null) => {
    armedIndex = index;
    slice.classed("armed", (d) => d.index === index);

    pieCenter.text(
      index == null
        ? (classLabel.get(pieFor!.class!) ?? "—")
        : (soilClasses[index].label ?? soilClasses[index].name),
    );
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

        gestureOpen = true;
        openPalette(x, y, layer);
      }

      armWedge(wedgeUnder(dx, dy));
    },
    { signal },
  );

  window.addEventListener(
    "pointerup",
    () => {
      if (!press) {
        return;
      }

      press = null;

      if (!gestureOpen) {
        return; // a quick click — the click handler opens the pie
      }

      gestureOpen = false;
      suppressClick = true;

      if (armedIndex != null) {
        commitClass(soilClasses[armedIndex]);
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

  // keyboard picking while the pie is open: arrows walk the wedges
  // clockwise/counter-clockwise from the layer's current class,
  // Enter or Space commits the armed wedge, Escape dismisses. Same
  // armWedge feedback as the drag, so both inputs read identically
  const keyStep: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closePalette();
        return;
      }

      if (!pieFor) {
        return;
      }

      const step = keyStep[event.key];

      if (step != null) {
        event.preventDefault(); // arrows would scroll the notebook

        // walk from the armed wedge, else the layer's current class;
        // a classless layer starts on the wedge nearest 12 o'clock in
        // the pressed direction
        const count = soilClasses.length;
        const active = soilClasses.findIndex((c) => c.name === pieFor!.class);
        const from = armedIndex ?? (active >= 0 ? active : step > 0 ? -1 : 0);

        armWedge((((from + step) % count) + count) % count);
      } else if ((event.key === "Enter" || event.key === " ") && armedIndex != null) {
        event.preventDefault();
        commitClass(soilClasses[armedIndex]);
      }
    },
    { signal },
  );

  // classify: click a layer and the pie opens under the pointer,
  // immediately — the lane owns split, so no double-click gesture is
  // left to disambiguate against. Press-and-drag is the fast path:
  // the pie opens on drag intent, release over (or beyond) a wedge
  // commits; its trailing click is swallowed. re-applied per join so
  // rects entering after an edit pick up the handlers
  const classifyLayers = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, Layer>("g.layer rect")
      .attr("cursor", "pointer")
      .on("pointerdown", (event: PointerEvent, d) => {
        if (event.button !== 0) {
          return;
        }

        const [px, py] = d3.pointer(event, el);

        suppressClick = false;
        press = { x: px, y: py, layer: d };
      })
      .on("click", (event: MouseEvent, d) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }

        const [px, py] = d3.pointer(event, el);
        openPalette(px, py, d);
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

  const joinEditColumn = () => {
    layersG.call(layerColumn, layers).call(classifyLayers);

    handlesG.call(boundaryHandles);
  };

  // full rebuild after a structural edit (split/merge): re-join layers
  // and handles, then re-place everything at the current zoom
  const updateEditColumn = () => {
    joinEditColumn();
    placeEditColumn(currentY());
  };

  // join only: currentY() closes over the zoom drive, which the caller
  // constructs after this returns — its initial placement (this column
  // is in the placers array) does the first place
  joinEditColumn();

  return placeHandles;
}
