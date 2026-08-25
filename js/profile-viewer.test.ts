// @vitest-environment jsdom
// the strip axes honor the channel side like the cpt chart: bottom
// channels stack below the strips left-to-right, top channels (Rf,
// incl) above them right-to-left, with the name labels above the top
// stack — so a curve never reads mirrored between the two widgets
import { describe, expect, it, vi } from "vitest";
import profile from "./profile-viewer";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const makeModel = (traits: Record<string, unknown>) => ({
  get: (k: string) => traits[k],
  set: () => {},
  save_changes: () => {},
  on: () => {},
  off: () => {},
});

describe("profile strip axis sides", () => {
  it("stacks qc below left-to-right and Rf above right-to-left", () => {
    const depths = [0, 1, 2, 3];
    const cpt = (name: string, distance: number) => ({
      name,
      distance,
      data: {
        nap: depths.map((d) => 5 - d),
        coneResistance: [1, 5, 10, 20],
        frictionRatio: [0.5, 1, 2, 4],
      },
    });
    const model = makeModel({
      cpts: [cpt("A", 0), cpt("B", 50)],
      verticalKey: "nap",
      channels: ["coneResistance", "frictionRatio"],
    });

    const el = document.createElement("div");
    document.body.appendChild(el);
    profile.render({ model, el, signal: undefined } as any);

    // defaults: height 500, nameBand 28, one top channel -> marginTop 58,
    // one bottom channel -> marginBottom 62, yBottom 438
    const strip = el.querySelector("g.strip")!;
    const transforms = [...strip.querySelectorAll("g.channel-axis")].map((g) =>
      g.getAttribute("transform"),
    );
    expect(transforms).toContain("translate(0,438)");
    expect(transforms).toContain("translate(0,58)");

    // the Rf axis renders as an axisTop: its tick text sits above the line
    // and its first tick (zero) sits at the strip's right edge
    const axes = [...strip.querySelectorAll("g.channel-axis")];
    const top = axes.find((g) => g.getAttribute("transform") === "translate(0,58)")!;
    const ticks = [...top.querySelectorAll("g.tick")].map((t) => ({
      x: t.getAttribute("transform"),
      label: t.querySelector("text")?.textContent,
    }));
    const xOf = (t: { x: string | null }) =>
      Number(/translate\(([\d.]+)/.exec(t.x ?? "")?.[1]);
    const zero = ticks.find((t) => t.label === "0")!;
    const max = ticks.reduce((a, b) => (Number(a.label) > Number(b.label) ? a : b));
    expect(xOf(zero)).toBeGreaterThan(xOf(max)); // zero at the right

    // bottom axis: zero at the left
    const bottom = axes.find((g) => g.getAttribute("transform") === "translate(0,438)")!;
    const bticks = [...bottom.querySelectorAll("g.tick")].map((t) => ({
      x: t.getAttribute("transform"),
      label: t.querySelector("text")?.textContent,
    }));
    const bzero = bticks.find((t) => t.label === "0")!;
    const bmax = bticks.reduce((a, b) => (Number(a.label) > Number(b.label) ? a : b));
    expect(xOf(bzero)).toBeLessThan(xOf(bmax));

    // name label above the top axis stack
    const name = strip.querySelector("text.name")!;
    expect(name.getAttribute("y")).toBe("20");
  });
});
