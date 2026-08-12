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
    expect(rig.rule.attr("x1")).toBe("50");
    expect(rig.rule.attr("x2")).toBe("350");
  });
});
