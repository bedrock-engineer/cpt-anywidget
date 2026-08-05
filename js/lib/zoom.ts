import * as d3 from "./d3";
import type { AnySelection, VerticalScale } from "./types";

// the shared vertical zoom gestures: wheel/drag zoom-pans the y scale,
// shift-brush zooms to the brushed range, double-click resets with a
// transition. onZoom receives the rescaled y on every change; the
// caller redraws everything that hangs off the vertical scale
export function verticalZoom(
  svg: AnySelection<SVGSVGElement>,
  {
    y,
    width,
    height,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    onZoom,
    wheelRequiresModifier = false,
  }: {
    y: VerticalScale;
    width: number;
    height: number;
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
    onZoom: (zy: VerticalScale) => void;
    // require ctrl/cmd for wheel zoom, so plain wheel scrolls the host
    // instead (trackpad pinch sets ctrlKey, so pinch-zoom still works)
    wheelRequiresModifier?: boolean;
  },
): void {
  let zy = y; // the currently zoomed vertical scale

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

  function brushEnded(this: SVGGElement, event: d3.D3BrushEvent<unknown>) {
    if (event.selection == null) {
      return;
    }

    const [p0, p1] = event.selection as [number, number];

    const selectedDomain = [zy.invert(p0), zy.invert(p1)]; // account for current zoom transform

    const [zp0, zp1] = [y(selectedDomain[0]), y(selectedDomain[1])];

    const newHeight = zp1 - zp0;
    const k = (height - marginBottom - marginTop) / newHeight;

    const z = d3.zoomIdentity
      .translate(0, marginTop)
      .scale(k)
      .translate(0, -zp0);

    svg.transition().duration(750).call(zoom.transform as any, z);

    d3.select(this).call(brush.move, null); // clear brush rect
  }

  svg.append("g").call(brush);

  function zoomed({ transform }: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    zy = transform.rescaleY(y);
    onZoom(zy);
  }

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 16])
    .filter((event) => {
      if (event.button) {
        return false;
      }
      if (event.type === "wheel") {
        if (wheelRequiresModifier) {
          return event.ctrlKey || event.metaKey;
        }
        return true;
      }
      // drag-pan: shift is reserved for the brush
      return !event.shiftKey;
    })
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
      svg
        .transition()
        .duration(750)
        .call(zoom.transform as any, d3.zoomIdentity),
    );
}
