import { describe, expect, it } from "vitest";
import { stripLayout } from "./strip-layout";

// the spacing-mode contract: the layout owns the mode, and flipping it
// flips centers, width and distX together — consumers read those live,
// so a mode where the three could disagree must be unrepresentable.
// The geometry math itself (tie dodging, the px/m collision floor) is
// exercised through the profile viewer for now

// chainages spread wide enough that true scale must grow the svg past
// the requested width — so the two modes' geometries genuinely differ
const make = () =>
  stripLayout({
    distances: [0, 100, 1000],
    stripWidth: 90,
    stripGap: 10,
    width: 700,
    marginLeft: 50,
    marginRight: 40,
  });

describe("stripLayout spacing mode", () => {
  it("defaults to true scale", () => {
    expect(make().equalSpacing()).toBe(false);
  });

  it("setter chains, getter echoes", () => {
    const layout = make();
    expect(layout.equalSpacing(true)).toBe(layout);
    expect(layout.equalSpacing()).toBe(true);
  });

  it("flipping the mode flips centers, width and distX together", () => {
    const layout = make();
    const centers = layout.centers();
    const width = layout.width();
    const distX = layout.distX();

    layout.equalSpacing(true);

    // all three switched, none kept serving the old mode
    expect(layout.centers()).not.toBe(centers);
    expect(layout.width()).toBeLessThan(width); // packs into the requested width
    expect(layout.distX()).not.toBe(distX);
    // distX agrees with the centers of its own mode: a strip's chainage
    // maps onto that strip's center
    expect(layout.distX()(100)).toBe(layout.centers()[1]);

    // flipping back restores the original geometry, same objects
    layout.equalSpacing(false);
    expect(layout.centers()).toBe(centers);
    expect(layout.width()).toBe(width);
    expect(layout.distX()).toBe(distX);
    expect(layout.distX()(100)).toBe(layout.centers()[1]);
  });
});
