// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as d3 from "./d3";
import type { AnySelection, VerticalScale } from "./types";
import { verticalZoom } from "./zoom";

// the zoom drive's setup contract: what the component promises at apply
// time — placement, paint order, error modes, live xExtent. Gesture paths
// (wheel, drag, brush, dblclick) stay manual-test territory: synthesizing
// them in jsdom proves nothing about real pointers

const baseScale = () => d3.scaleLinear().domain([0, 10]).range([24, 790]);

const applied = (placers: ((y1: VerticalScale) => void)[] = []) => {
  const svg = d3.select(document.body).append("svg");
  const y = baseScale();
  const vz = verticalZoom().scale(y).xExtent([60, 350]).placers(placers);
  svg.call(vz);
  return { svg, y, vz };
};

const enter = (svg: AnySelection<SVGSVGElement>) =>
  svg.node()!.dispatchEvent(new Event("pointerenter"));

describe("verticalZoom accessors", () => {
  it("setters chain, getters echo", () => {
    const y = baseScale();
    const x = () => [60, 350] as [number, number];
    const vz = verticalZoom();
    expect(vz.scale(y)).toBe(vz);
    expect(vz.scale()).toBe(y);
    expect(vz.xExtent(x)).toBe(vz);
    expect(vz.xExtent()).toBe(x);
    expect(vz.placers([])).toBe(vz);
  });

  it("scaleExtent defaults to [1, 16]", () => {
    expect(verticalZoom().scaleExtent()).toEqual([1, 16]);
  });

  it("a function xExtent is not evaluated at configure time", () => {
    let calls = 0;
    verticalZoom().xExtent(() => (calls++, [60, 350]));
    expect(calls).toBe(0);
  });
});

describe("verticalZoom apply", () => {
  it("places every placer once, with the base scale, in array order", () => {
    const calls: [string, VerticalScale][] = [];
    const { y } = applied([(y1) => calls.push(["a", y1]), (y1) => calls.push(["b", y1])]);

    expect(calls.map(([name]) => name)).toEqual(["a", "b"]);
    for (const [, y1] of calls) {
      expect(y1).toBe(y);
    }
  });

  it("currentScale() is the base scale before apply and before any gesture", () => {
    const y = baseScale();
    const vz = verticalZoom().scale(y).xExtent([60, 350]);
    expect(vz.currentScale()).toBe(y); // valid before apply — no forward reference

    d3.select(document.body).append("svg").call(vz);
    expect(vz.currentScale()).toBe(y);
  });

  it("throws without a scale, without an xExtent, on an empty selection, and on double apply", () => {
    const svg = d3.select(document.body).append("svg");
    const y = baseScale();

    expect(() => svg.call(verticalZoom().xExtent([60, 350]))).toThrow(TypeError);
    expect(() => svg.call(verticalZoom().scale(y))).toThrow(TypeError);

    const vz = verticalZoom().scale(y).xExtent([60, 350]);
    expect(() => d3.select(document.body).select<SVGSVGElement>("no-such").call(vz)).toThrow(
      /empty selection/,
    );
    svg.call(vz);
    expect(() => svg.call(vz)).toThrow(/already applied/);
  });
});

describe("verticalZoom paint order and live xExtent", () => {
  it("re-raises the brush overlay above content appended after apply", () => {
    const { svg } = applied();
    svg.append("rect"); // an append the 'call the drive last' comment used to forbid

    enter(svg);

    const last = svg.node()!.lastElementChild!;
    expect(last.querySelector(".overlay")).not.toBeNull(); // the brush group is topmost again
  });

  it("re-fits the brush overlay to a changed xExtent on pointerenter", () => {
    const svg = d3.select(document.body).append("svg");
    let right = 350;
    const vz = verticalZoom()
      .scale(baseScale())
      .xExtent(() => [60, right]);
    svg.call(vz);

    right = 500; // the profile's spacing toggle widening the plot
    enter(svg);

    expect(svg.select(".overlay").attr("width")).toBe("440");
  });
});
