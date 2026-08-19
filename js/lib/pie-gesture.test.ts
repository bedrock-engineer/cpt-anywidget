import { describe, expect, it } from "vitest";
import { pieAngles } from "./pie-menu";
import { pieGesture } from "./pie-gesture";
import type { Layer } from "./types";

// four wedges from the real pie layout's angles: index 0 centered on
// 12 o'clock, clockwise — so a move of (0, -50) from the press points
// at wedge 0, (50, 0) at wedge 1, and so on
const arcs = (() => {
  const count = 4;
  const { startAngle } = pieAngles(count);
  const width = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => ({
    startAngle: startAngle + i * width,
    endAngle: startAngle + (i + 1) * width,
  }));
})();

const layer: Layer = { top: 0, bottom: 5 };

const make = () => pieGesture({ arcs, deadZone: 24, slop: 4 });

describe("pieGesture press-drag-release", () => {
  it("a quick stationary click opens on the trailing click", () => {
    const g = make();
    g.press(10, 10, layer);
    expect(g.release()).toEqual({ kind: "none" });
    expect(g.click(10, 10, layer)).toEqual({
      kind: "open",
      x: 10,
      y: 10,
      layer,
      armed: null,
    });
    expect(g.layer()).toBe(layer);
  });

  it("movement under the slop is not drag intent", () => {
    const g = make();
    g.press(10, 10, layer);
    expect(g.move(12, 11)).toEqual({ kind: "none" });
    expect(g.layer()).toBeNull();
  });

  it("crossing the slop opens the pie at the press point", () => {
    const g = make();
    g.press(10, 10, layer);
    // 10 px straight up: past the slop, inside the dead zone
    expect(g.move(10, 0)).toEqual({
      kind: "open",
      x: 10,
      y: 10,
      layer,
      armed: null,
    });
    // on past the dead zone: the wedge on the bearing arms
    expect(g.move(10, -40)).toEqual({ kind: "arm", index: 0 });
    expect(g.move(60, 10)).toEqual({ kind: "arm", index: 1 });
  });

  it("release over a wedge commits it and swallows the trailing click", () => {
    const g = make();
    g.press(0, 0, layer);
    g.move(0, -50);
    expect(g.release()).toEqual({ kind: "commit", index: 0, layer });
    expect(g.layer()).toBeNull();

    // the gesture's own click is swallowed once
    expect(g.click(0, -50, layer)).toEqual({ kind: "none" });
    // a fresh press-click opens again
    g.press(0, 0, layer);
    g.release();
    expect(g.click(0, 0, layer).kind).toBe("open");
  });

  it("a dead-zone release keeps the pie open for click-to-pick", () => {
    const g = make();
    g.press(0, 0, layer);
    g.move(0, -10); // drag intent, but no wedge
    expect(g.release()).toEqual({ kind: "none" });
    expect(g.layer()).toBe(layer); // still open
    // and its trailing click must not re-open under the pointer
    expect(g.click(0, -10, layer)).toEqual({ kind: "none" });
  });
});

describe("pieGesture keyboard", () => {
  const open = () => {
    const g = make();
    g.press(10, 10, layer);
    g.release();
    g.click(10, 10, layer);
    return g;
  };

  it("does nothing while the pie is closed", () => {
    expect(make().key("ArrowRight", 2)).toEqual({ kind: "none" });
  });

  it("arrows walk from the layer's current class, wrapping", () => {
    const g = open();
    expect(g.key("ArrowRight", 2)).toEqual({ kind: "arm", index: 3 });
    expect(g.key("ArrowRight", 2)).toEqual({ kind: "arm", index: 0 }); // from armed, wrapped
    expect(g.key("ArrowLeft", 2)).toEqual({ kind: "arm", index: 3 });
  });

  it("a classless layer starts on the wedge nearest 12 o'clock in the pressed direction", () => {
    expect(open().key("ArrowRight", -1)).toEqual({ kind: "arm", index: 0 });
    expect(open().key("ArrowLeft", -1)).toEqual({ kind: "arm", index: 3 });
  });

  it("Enter commits the armed wedge, and only an armed one", () => {
    const g = open();
    expect(g.key("Enter", -1)).toEqual({ kind: "none" });
    g.key("ArrowRight", -1);
    expect(g.key("Enter", -1)).toEqual({ kind: "commit", index: 0, layer });
    expect(g.layer()).toBeNull();
  });
});

describe("pieGesture reset", () => {
  it("forgets the press, the open pie and the armed wedge", () => {
    const g = make();
    g.press(0, 0, layer);
    g.move(0, -50);
    g.reset();
    expect(g.pressed()).toBe(false);
    expect(g.layer()).toBeNull();
    expect(g.release()).toEqual({ kind: "none" });
    // dismissal does not swallow the next click
    expect(g.click(0, 0, layer).kind).toBe("open");
  });
});
