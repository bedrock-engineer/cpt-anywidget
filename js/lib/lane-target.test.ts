import { describe, expect, it } from "vitest";
import * as d3 from "./d3";
import { laneTarget } from "./lane-target";

// depth orientation: 10 px per vertical unit, so boundary values read
// directly as pixels × 10
const y = d3.scaleLinear().domain([0, 10]).range([0, 100]);

const depthLayers = [
  { top: 0, bottom: 3 },
  { top: 3, bottom: 5 },
  { top: 5, bottom: 9 },
];

// nap orientation: same stack upside down, values descending
const napLayers = [
  { top: 9, bottom: 5 },
  { top: 5, bottom: 3 },
  { top: 3, bottom: 0 },
];
const yNap = d3.scaleLinear().domain([10, 0]).range([0, 100]);

describe("laneTarget", () => {
  it("snaps to the nearest internal boundary as a merge", () => {
    expect(laneTarget(depthLayers, y, 52)).toEqual({
      kind: "merge",
      boundary: 1,
      at: 50,
    });
    // the stack's outer edges are not boundaries — nothing to merge
    expect(laneTarget(depthLayers, y, 2)?.kind).toBe("split");
    expect(laneTarget(depthLayers, y, 89)?.kind).toBe("split");
  });

  it("offers a split in the containing layer, at the inverted value", () => {
    expect(laneTarget(depthLayers, y, 70)).toEqual({
      kind: "split",
      layer: 2,
      value: 7,
      at: 70,
    });
  });

  it("offers nothing outside the stack", () => {
    expect(laneTarget(depthLayers, y, 95)).toBeNull();
    expect(laneTarget([], y, 50)).toBeNull();
  });

  it("the snap distance decides merge vs split", () => {
    // 6 px off the boundary at 50: outside the default snap (< 6)
    expect(laneTarget(depthLayers, y, 44)?.kind).toBe("split");
    expect(laneTarget(depthLayers, y, 44, 7)?.kind).toBe("merge");
  });

  it("is orientation-agnostic", () => {
    // nap: the boundary at value 5 sits at y = 50 on the flipped scale
    expect(laneTarget(napLayers, yNap, 52)).toEqual({
      kind: "merge",
      boundary: 0,
      at: 50,
    });
    expect(laneTarget(napLayers, yNap, 80)).toEqual({
      kind: "split",
      layer: 2,
      // inverting the flipped scale carries float noise
      value: expect.closeTo(2),
      at: 80,
    });
  });
});
