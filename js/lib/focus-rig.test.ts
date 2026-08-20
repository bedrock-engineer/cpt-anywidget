// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as d3 from "./d3";
import { focusRig } from "./focus-rig";

const setup = () =>
  focusRig(d3.select(document.body).append("svg"), { marginLeft: 50, ruleX2: 350 });

describe("focusRig", () => {
  it("starts hidden and never intercepts pointer events", () => {
    const rig = setup();
    expect(rig.focus.attr("display")).toBe("none");
    expect(rig.focus.attr("pointer-events")).toBe("none");
  });

  it("show translates the group to the pixel and reveals it; hide re-hides", () => {
    const rig = setup();
    rig.show(42);
    expect(rig.focus.attr("display")).toBeNull();
    expect(rig.focus.attr("transform")).toBe("translate(0,42)");
    rig.hide();
    expect(rig.focus.attr("display")).toBe("none");
  });

  it("spans the rule from the axis to the given right edge", () => {
    const rig = setup();
    const rule = rig.focus.select("line");
    expect(rule.attr("x1")).toBe("50");
    expect(rule.attr("x2")).toBe("350");
  });

  it("re-reads a ruleX2 thunk on every show", () => {
    let right = 350;
    const rig = focusRig(d3.select(document.body).append("svg"), {
      marginLeft: 50,
      ruleX2: () => right,
    });

    right = 500; // the profile's spacing toggle widening the plot
    rig.show(42);

    expect(rig.focus.select("line").attr("x2")).toBe("500");
  });

  it("readoutHost relocates the readout and keeps show/hide in sync", () => {
    const overlay = d3.select(document.body).append("svg");
    const rig = focusRig(d3.select(document.body).append("svg"), {
      marginLeft: 50,
      ruleX2: 350,
      readoutHost: overlay,
    });
    expect(overlay.node()!.contains(rig.readout.node())).toBe(true);
    expect(rig.focus.node()!.contains(rig.readout.node())).toBe(false);

    const readoutGroup = d3.select<SVGGElement, unknown>(
      rig.readout.node()!.parentNode as SVGGElement,
    );
    expect(readoutGroup.attr("display")).toBe("none");
    expect(readoutGroup.attr("pointer-events")).toBe("none");

    rig.show(42);
    expect(rig.focus.attr("transform")).toBe("translate(0,42)");
    expect(readoutGroup.attr("transform")).toBe("translate(0,42)");
    expect(readoutGroup.attr("display")).toBeNull();

    rig.hide();
    expect(rig.focus.attr("display")).toBe("none");
    expect(readoutGroup.attr("display")).toBe("none");
  });
});
