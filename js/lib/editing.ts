import * as d3 from "./d3";
import { placeLayerColumn } from "./layers";
import type { LayerColumn } from "./layers";
import type {
  AnySelection,
  Layer,
  Placer,
  SoilClass,
  VerticalScale,
} from "./types";

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
// merge (the upper layer wins), click a layer to pick its class from
// the soil-class pie. Mutates editedLayers in place and syncs copies
// back through the model. Returns the handle placer for the zoom loop —
// layer-rect placement rides the caller's shared column placer.
// currentY() returns the live (zoomed) scale
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

  const reflectAltKey = (event: Event) => {
    altHeld = event.type === "blur" ? false : (event as KeyboardEvent).altKey;
    handlesG.selectAll("rect.handle").attr("cursor", handleCursor());
  };

  for (const type of ["keydown", "keyup", "blur"]) {
    window.addEventListener(type, reflectAltKey, { signal });
  }

  const dragHandler = d3
    .drag<SVGRectElement, number>()
    .filter((event) => !event.altKey) // option-click is the merge gesture, not a drag
    // anchor the gesture to the boundary value, so grabbing the strip
    // slightly off-center doesn't make the boundary jump
    .subject((event, i) => ({
      x: event.x,
      y: currentY()(editedLayers[i].bottom),
    }))
    .on("drag", (event, i) => {
      const above = editedLayers[i];
      const below = editedLayers[i + 1];
      const lo = Math.min(above.top, below.bottom) + minThickness;
      const hi = Math.max(above.top, below.bottom) - minThickness;
      const value = Math.max(lo, Math.min(hi, currentY().invert(event.y)));

      above.bottom = value;
      below.top = value;

      placeEditColumn(currentY());
    })
    .on("end", () => {
      syncEditedLayers();
    });

  // invisible hit strips over each internal boundary; dragging one
  // moves the shared boundary between the two adjacent layers.
  // re-callable like layerColumn, so structural edits re-join
  const boundaryHandles = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, number>("rect.handle")
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
      .on("click", (event: MouseEvent, i) => {
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
    .attr("viewBox", [-pieSize / 2, -pieSize / 2, pieSize, pieSize].join(","))
    .attr("width", pieSize)
    .attr("height", pieSize);

  // equal slices — the pie layout only carries the angles. sort(null)
  // keeps palette order; the default sorts by value, which with equal
  // values would scramble the angular contract
  const halfSlice = Math.PI / soilClasses.length;
  const pieArcs = d3
    .pie<SoilClass>()
    .value(1)
    .sort(null)
    .startAngle(-halfSlice)
    .endAngle(2 * Math.PI - halfSlice)(soilClasses);

  const sliceArc = d3
    .arc<d3.PieArcDatum<SoilClass>>()
    .innerRadius(pieInner)
    .outerRadius(pieOuter);
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

  const closePalette = () => {
    clearTimeout(paletteTimer);
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

    pieCenter.text(classLabel.get(layer.class!) ?? "—");

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
      if (!event.composedPath().includes(palette.node()!)) {
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
  const classifyLayers = (parent: AnySelection<SVGGElement>) =>
    parent
      .selectAll<SVGRectElement, Layer>("g.layer rect")
      .on("click", (event: MouseEvent, d) => {
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

        const lo = Math.min(d.top, d.bottom) + minThickness;
        const hi = Math.max(d.top, d.bottom) - minThickness;

        if (lo > hi) {
          return; // too thin to split
        }

        // the column group is only translated in x, so local y is svg y
        const value = Math.max(
          lo,
          Math.min(hi, currentY().invert(d3.pointer(event)[1])),
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

  const placeHandles: Placer = (y1) =>
    handlesG
      .selectAll<SVGRectElement, number>("rect.handle")
      .attr("y", (i) => y1(editedLayers[i].bottom) - 4.5);

  // layer placement rides the shared column placer during zoom; drags
  // and structural edits re-place layers and handles together
  const placeEditColumn = (y1: VerticalScale) => {
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

    placeEditColumn(currentY());
  };

  updateEditColumn();

  return placeHandles;
}
