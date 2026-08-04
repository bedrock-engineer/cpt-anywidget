import * as d3 from "./d3";
import type {
  AxisLimits,
  ChannelSpec,
  CptData,
  Samples,
  Series,
  VerticalScale,
} from "./types";

// built-in display defaults for the common BRO channels; a channels
// entry overrides these per key, side defaults to "bottom"
// prettier-ignore
export const channelDefaults: Record<string, Omit<ChannelSpec, "key">> = {
  coneResistance: { label: "qc",   unit: "MPa", color: "steelblue" },
  localFriction:  { label: "fs",   unit: "MPa", color: "#e15759" },
  porePressureU1: { label: "u1",   unit: "MPa", color: "#af7aa1" },
  porePressureU2: { label: "u2",   unit: "MPa", color: "#76b7b2" },
  frictionRatio:  { label: "Rf",   unit: "%",   color: "#59a14f", side: "top" },
  inclination:    { label: "incl", unit: "°",   color: "#9c755f", side: "top" },
};

// x scale for one channel; explicit limits are honored exactly, the
// data-driven fallback is niced. null when the channel has no data
export function makeXScale(
  values: Samples | undefined,
  range: [number, number],
  limits: [number, number] | undefined,
): d3.ScaleLinear<number, number> | null {
  const finite = (values ?? []).filter((v) => v != null);

  if (!finite.length) {
    return null;
  }

  const scale = d3.scaleLinear().range(range);

  return limits
    ? scale.domain(limits)
    : scale.domain([Math.min(0, d3.min(finite)!), d3.max(finite)!]).nice();
}

// resolve requested channels against the display defaults and the data:
// merged specs with an x scale and the value column attached, in axis
// stacking order; channels without data are dropped. Empty request =
// all default channels
export function buildSeries({
  channels,
  cptData,
  axisLimits,
  rangeBottom,
  rangeTop,
}: {
  channels: ChannelSpec[];
  cptData: CptData;
  axisLimits: AxisLimits;
  rangeBottom: [number, number];
  rangeTop: [number, number];
}): Series[] {
  const requested = channels.length
    ? channels
    : Object.keys(channelDefaults).map((key) => ({ key }));

  const series = requested
    .map((c, i) => {
      const merged = { side: "bottom", ...channelDefaults[c.key], ...c };

      return {
        ...merged,
        label: merged.label ?? c.key,
        color: merged.color ?? d3.schemeTableau10[i % 10],
        x: makeXScale(
          cptData[c.key],
          merged.side === "top" ? rangeTop : rangeBottom,
          axisLimits[c.key],
        ),
      };
    })
    .filter((s) => s.x) as Series[];

  for (const s of series) {
    s.values = cptData[s.key];
  }

  return series;
}

// path for one series: values in the series' x, vertical samples on a
// (possibly zoomed) y scale
export function lineFor(
  s: Series,
  vertical: Samples,
  y1: VerticalScale,
): string | null {
  return d3
    .line<number | null>()
    .defined((_, i) => s.values[i] != null && vertical[i] != null)
    .x((_, i) => s.x(s.values[i]!))
    .y((_, i) => y1(vertical[i]!))(vertical);
}
