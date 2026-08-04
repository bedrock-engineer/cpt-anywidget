// the d3 submodules this package actually uses, re-exported as one
// namespace so call sites keep the familiar `d3.*` form. d3-transition
// is also a side-effect import: it patches selection.prototype.transition
export * from "d3-array";
export * from "d3-axis";
export * from "d3-brush";
export * from "d3-color";
export * from "d3-drag";
export * from "d3-format";
export * from "d3-scale";
export * from "d3-scale-chromatic";
export * from "d3-selection";
export * from "d3-shape";
export * from "d3-transition";
export * from "d3-zoom";
