import * as d3 from "./d3";
import type { AnySelection, Placer, VerticalScale } from "./types";

// the shared vertical zoom gestures: ctrl/cmd-wheel and drag zoom-pan the
// y scale (plain wheel scrolls the host; trackpad pinch sets ctrlKey, so
// pinch-zoom still works), shift-brush zooms to the brushed range,
// double-click resets with a transition. This is the zoom drive, shaped
// like a d3 component: build with the factory, configure through chained
// accessors, apply with svg.call(vz). It owns the current (zoomed) scale,
// places every placer once at apply and again on every change, and exposes
// currentScale() — valid as soon as scale() is set, so event handlers can
// take it before the component is applied. The vertical gesture band is
// the scale's range (the two could never sanely differ); xExtent is the
// horizontal band, and a function form is re-read per gesture so live
// widths never go stale. The brush overlay re-raises and re-fits itself on
// every pointerenter, so apply order in the entry is free.

type XExtent = [number, number] | (() => [number, number]);

export interface VerticalZoom {
  /** apply to exactly one <svg>: binds the gestures, appends the brush
      overlay, and runs the initial placement pass (every placer once, in
      array order, with the base scale) — callers never place by hand */
  (svg: AnySelection<SVGSVGElement>): void;

  /** the base (unzoomed) vertical scale; its range is the vertical
      gesture band. Must be set before apply */
  scale(): VerticalScale;
  scale(y: VerticalScale): VerticalZoom;

  /** the horizontal gesture band [x0, x1] in svg pixels; a function is
      re-read per gesture — pass one when the width can change after
      setup. Must be set before apply */
  xExtent(): XExtent;
  xExtent(x: XExtent): VerticalZoom;

  /** zoom factor range, [1, 16] unless set before apply */
  scaleExtent(): [number, number];
  scaleExtent(e: [number, number]): VerticalZoom;

  /** everything that hangs off the vertical scale, in paint order;
      read per placement pass */
  placers(): Placer[];
  placers(p: Placer[]): VerticalZoom;

  /** the current (zoomed) scale — the base scale before any gesture */
  currentScale(): VerticalScale;
}

export function verticalZoom(): VerticalZoom {
  let y: VerticalScale | undefined;
  let xExtent: XExtent | undefined;
  let scaleExtent: [number, number] = [1, 16];
  let placers: Placer[] = [];
  let zy: VerticalScale | undefined; // the currently zoomed scale
  let applied = false;

  const vz = ((svg: AnySelection<SVGSVGElement>) => {
    if (!y) {
      throw new TypeError("verticalZoom: set scale() before applying");
    }
    if (!xExtent) {
      throw new TypeError("verticalZoom: set xExtent() before applying");
    }
    if (svg.empty()) {
      throw new Error("verticalZoom: applied to an empty selection");
    }
    if (applied) {
      throw new Error("verticalZoom: already applied — one instance per svg");
    }
    applied = true;

    const base = y;
    // the vertical gesture band is the scale's range, whichever way round
    const [top, bottom] = d3.extent(base.range()) as [number, number];
    const band = (): [[number, number], [number, number]] => {
      const [x0, x1] = typeof xExtent === "function" ? xExtent() : xExtent!;
      return [
        [x0, top],
        [x1, bottom],
      ];
    };

    const placeAll = () => placers.forEach((place) => place(zy ?? base));

    placeAll(); // the initial placement pass

    // Brushing
    const brush = d3
      .brushY()
      // only brush with shift key down
      .keyModifiers(false)
      .filter((event) => event.shiftKey)
      .extent(band) // re-read whenever the brush is (re)applied
      .on("end", brushEnded);

    function brushEnded(this: SVGGElement, event: d3.D3BrushEvent<unknown>) {
      if (event.selection == null) {
        return;
      }

      const [p0, p1] = event.selection as [number, number];

      const cur = zy ?? base;
      const selectedDomain = [cur.invert(p0), cur.invert(p1)]; // account for current zoom transform

      const [zp0, zp1] = [base(selectedDomain[0]), base(selectedDomain[1])];

      const newHeight = zp1 - zp0;
      const k = (bottom - top) / newHeight;

      const z = d3.zoomIdentity.translate(0, top).scale(k).translate(0, -zp0);

      svg
        .transition()
        .duration(500)
        .call(zoom.transform as any, z);

      d3.select(this).call(brush.move, null); // clear brush rect
    }

    const gBrush = svg.append("g").call(brush);

    function zoomed({ transform }: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
      zy = transform.rescaleY(base);
      placeAll();
    }

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(scaleExtent)
      .filter((event) => {
        if (event.button) {
          return false;
        }
        if (event.type === "wheel") {
          return event.ctrlKey || event.metaKey;
        }
        // drag-pan: shift is reserved for the brush
        return !event.shiftKey;
      })
      .extent(band) // a function: d3 re-reads it per gesture
      .translateExtent([
        [-Infinity, top],
        [Infinity, bottom],
      ])
      .on("zoom", zoomed);

    svg
      .call(zoom)
      // double-click resets with an animated transition instead of zooming in
      .on("dblclick.zoom", null)
      .on("dblclick.vzoom", () =>
        svg
          .transition()
          .duration(500)
          .call(zoom.transform as any, d3.zoomIdentity),
      )
      // the pointer must enter the svg before any gesture can start, so
      // this is where the brush overlay re-fits to a changed xExtent and
      // re-raises above anything appended after apply — the reason entries
      // are free to call the drive in any order
      .on("pointerenter.vzoom", () => {
        gBrush.call(brush).raise();
      });
  }) as VerticalZoom;

  vz.scale = ((v?: VerticalScale) =>
    v === undefined ? y : ((y = v), vz)) as VerticalZoom["scale"];
  vz.xExtent = ((v?: XExtent) =>
    v === undefined ? xExtent : ((xExtent = v), vz)) as VerticalZoom["xExtent"];
  vz.scaleExtent = ((v?: [number, number]) =>
    v === undefined ? scaleExtent : ((scaleExtent = v), vz)) as VerticalZoom["scaleExtent"];
  vz.placers = ((v?: Placer[]) =>
    v === undefined ? placers : ((placers = v), vz)) as VerticalZoom["placers"];
  vz.currentScale = () => (zy ?? y)!;

  return vz;
}
