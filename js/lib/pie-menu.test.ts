import { pie } from "d3-shape";
import { describe, expect, it } from "vitest";
import { pieAngles, wedgeAt } from "./pie-menu";

// the same layout call editing.ts makes, so the test exercises the
// real angular contract
const arcsFor = (count: number) => {
  const { startAngle, endAngle } = pieAngles(count);
  return pie<number>().value(1).sort(null).startAngle(startAngle).endAngle(endAngle)(
    Array.from({ length: count }, () => 1),
  );
};

// (dx, dy) displacement for a clockwise-from-12-o'clock bearing
const at = (deg: number, r = 100): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [Math.sin(rad) * r, -Math.cos(rad) * r];
};

const deadZone = 24;

describe("wedgeAt", () => {
  it("centers the first wedge on 12 o'clock", () => {
    expect(wedgeAt(arcsFor(6), ...at(0), deadZone)).toBe(0);
  });

  it("returns null inside the dead zone", () => {
    expect(wedgeAt(arcsFor(6), ...at(0, deadZone - 1), deadZone)).toBeNull();
  });

  it("walks the wedges clockwise in palette order", () => {
    const arcs = arcsFor(6); // 60° wedges: [−30, 30), [30, 90), …
    expect(wedgeAt(arcs, ...at(60), deadZone)).toBe(1);
    expect(wedgeAt(arcs, ...at(120), deadZone)).toBe(2);
    expect(wedgeAt(arcs, ...at(180), deadZone)).toBe(3);
    expect(wedgeAt(arcs, ...at(240), deadZone)).toBe(4);
    expect(wedgeAt(arcs, ...at(300), deadZone)).toBe(5);
  });

  it("wraps around: just left of 12 o'clock is still the first wedge", () => {
    expect(wedgeAt(arcsFor(6), ...at(-10), deadZone)).toBe(0);
    expect(wedgeAt(arcsFor(6), ...at(350), deadZone)).toBe(0);
  });

  it("only direction matters past the dead zone — a far flick still picks", () => {
    expect(wedgeAt(arcsFor(6), ...at(60, 5000), deadZone)).toBe(1);
  });

  // the exact boundary bearing is float-determined and never matters
  // for a real pointer — assert just either side of it instead
  it("splits ownership at the wedge boundary", () => {
    expect(wedgeAt(arcsFor(6), ...at(29.99), deadZone)).toBe(0);
    expect(wedgeAt(arcsFor(6), ...at(30.01), deadZone)).toBe(1);
  });
});
