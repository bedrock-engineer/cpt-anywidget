// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as d3 from "./d3";
import type { VerticalScale } from "./types";
import { verticalZoom } from "./zoom";

// the zoom drive's setup contract — the entries deleted their hand-written
// initial place(y) calls on the promise that verticalZoom makes them.
// Gesture paths (wheel, drag, brush, dblclick) stay manual-test territory:
// synthesizing them in jsdom proves nothing about real pointers

const setup = (placers: ((y1: VerticalScale) => void)[]) => {
  const svg = d3.select(document.body).append("svg");
  const y = d3.scaleLinear().domain([0, 10]).range([24, 790]);
  const current = verticalZoom(svg, {
    y,
    width: 400,
    height: 800,
    marginLeft: 60,
    marginRight: 50,
    marginTop: 24,
    marginBottom: 10,
    placers,
  });
  return { y, current };
};

describe("verticalZoom", () => {
  it("places every placer once at setup, with the base scale, in array order", () => {
    const calls: [string, VerticalScale][] = [];
    const { y } = setup([(y1) => calls.push(["a", y1]), (y1) => calls.push(["b", y1])]);

    expect(calls.map(([name]) => name)).toEqual(["a", "b"]);
    for (const [, y1] of calls) {
      expect(y1).toBe(y);
    }
  });

  it("current() returns the base scale before any gesture", () => {
    const { y, current } = setup([]);
    expect(current()).toBe(y);
  });
});
