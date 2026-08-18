import { describe, expect, it } from "vitest";
import { assignClass, dragBoundary, merge, minThickness, seedLayer, splitAt } from "./layer-edits";
import type { Layer } from "./types";

// one fixture per vertical orientation: depth is positive down
// (top < bottom), NAP is positive up (top > bottom)
const depthStack = (): Layer[] => [
  { top: 0, bottom: 2, class: "sand" },
  { top: 2, bottom: 5, class: "clay" },
  { top: 5, bottom: 9, class: "peat" },
];

const napStack = (): Layer[] => [
  { top: 3, bottom: 1, class: "sand" },
  { top: 1, bottom: -2, class: "clay" },
  { top: -2, bottom: -6, class: "peat" },
];

describe("seedLayer", () => {
  it("creates a single classless layer spanning the extent", () => {
    expect(seedLayer(0, 9)).toEqual([{ top: 0, bottom: 9 }]);
  });

  it("keeps the NAP orientation (top > bottom)", () => {
    expect(seedLayer(3, -6)).toEqual([{ top: 3, bottom: -6 }]);
  });
});

describe("dragBoundary", () => {
  it("moves the shared boundary, leaving the input untouched", () => {
    const layers = depthStack();
    const next = dragBoundary(layers, 0, 3);

    expect(next).not.toBe(layers);
    expect(next[0].bottom).toBe(3);
    expect(next[1].top).toBe(3);
    expect(next[2]).toBe(layers[2]); // untouched layers pass through
    expect(layers).toEqual(depthStack());
  });

  it("clamps so neither neighbour drops below minThickness", () => {
    const pinnedLow = dragBoundary(depthStack(), 0, -10);
    expect(pinnedLow[0].bottom).toBe(0 + minThickness);

    const pinnedHigh = dragBoundary(depthStack(), 0, 10);
    expect(pinnedHigh[0].bottom).toBe(5 - minThickness);
  });

  it("clamps in the NAP orientation too", () => {
    // boundary between top 3 and bottom −2, positive up
    const pinnedUp = dragBoundary(napStack(), 0, 10);
    expect(pinnedUp[0].bottom).toBe(3 - minThickness);

    const pinnedDown = dragBoundary(napStack(), 0, -10);
    expect(pinnedDown[0].bottom).toBe(-2 + minThickness);
  });

  it("returns the same reference when the value clamps back to where it was", () => {
    const layers = depthStack();
    expect(dragBoundary(layers, 0, 2)).toBe(layers);
  });

  it("returns the same reference for an out-of-range boundary", () => {
    const layers = depthStack();
    expect(dragBoundary(layers, 2, 3)).toBe(layers);
    expect(dragBoundary(layers, -1, 3)).toBe(layers);
  });
});

describe("splitAt", () => {
  it("splits into two halves sharing the new boundary, both keeping the class", () => {
    const layers = depthStack();
    const next = splitAt(layers, 1, 3.5);

    expect(next).toHaveLength(4);
    expect(next[1]).toEqual({ top: 2, bottom: 3.5, class: "clay" });
    expect(next[2]).toEqual({ top: 3.5, bottom: 5, class: "clay" });
    expect(layers).toEqual(depthStack());
  });

  it("clamps the split inside the layer", () => {
    const next = splitAt(depthStack(), 0, -10);
    expect(next[0].bottom).toBe(0 + minThickness);
  });

  it("splits in the NAP orientation", () => {
    const next = splitAt(napStack(), 1, 0);
    expect(next[1]).toEqual({ top: 1, bottom: 0, class: "clay" });
    expect(next[2]).toEqual({ top: 0, bottom: -2, class: "clay" });
  });

  it("returns the same reference when the layer is too thin to split", () => {
    const layers: Layer[] = [{ top: 0, bottom: 1.5 * minThickness, class: "sand" }];
    expect(splitAt(layers, 0, minThickness)).toBe(layers);
  });
});

describe("merge", () => {
  it("removes the boundary; the upper layer absorbs the lower and keeps its class", () => {
    const layers = depthStack();
    const next = merge(layers, 0);

    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ top: 0, bottom: 5, class: "sand" });
    expect(next[1]).toBe(layers[2]);
    expect(layers).toEqual(depthStack());
  });

  it("merges in the NAP orientation", () => {
    const next = merge(napStack(), 1);
    expect(next[1]).toEqual({ top: 1, bottom: -6, class: "clay" });
  });

  it("returns the same reference for an out-of-range boundary", () => {
    const layers = depthStack();
    expect(merge(layers, 2)).toBe(layers);
  });
});

describe("assignClass", () => {
  it("sets the class and drops stale denormalized color/label", () => {
    const layers: Layer[] = [{ top: 0, bottom: 2, color: "#abc", label: "Sandy" }];
    const next = assignClass(layers, 0, "sand");

    expect(next[0]).toEqual({ top: 0, bottom: 2, class: "sand" });
    expect(layers[0]).toEqual({ top: 0, bottom: 2, color: "#abc", label: "Sandy" });
  });

  it("returns the same reference when the class already drives the display", () => {
    const layers = depthStack();
    expect(assignClass(layers, 0, "sand")).toBe(layers);
  });

  it("still assigns when the class matches but stale display props linger", () => {
    const layers: Layer[] = [{ top: 0, bottom: 2, class: "sand", color: "#abc" }];
    const next = assignClass(layers, 0, "sand");
    expect(next).not.toBe(layers);
    expect(next[0]).toEqual({ top: 0, bottom: 2, class: "sand" });
  });

  it("returns the same reference for an out-of-range index", () => {
    const layers = depthStack();
    expect(assignClass(layers, 5, "sand")).toBe(layers);
  });
});
