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

/** a fully resolved channel binding: display fields filled in (a
 * channel without a unit stays unitless) */
export type ResolvedChannel = Required<Omit<ChannelSpec, "unit">> &
  Pick<ChannelSpec, "unit">;

// resolve a channel request (a key string or spec) against the display
// defaults, mirroring resolveVertical: unknown keys label as themselves
// and explicit fields win. None from a hand-built Python dict arrives
// as null, so nullish fields are dropped rather than allowed to shadow
// a default
export function resolveChannel(
  raw: string | ChannelSpec,
  fallbackColor: string,
): ResolvedChannel {
  const spec = typeof raw === "string" ? { key: raw } : raw;
  return {
    label: spec.key,
    color: fallbackColor,
    side: "bottom",
    ...channelDefaults[spec.key],
    ...Object.fromEntries(Object.entries(spec).filter(([, v]) => v != null)),
  } as ResolvedChannel;
}

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
  channels: (string | ChannelSpec)[];
  cptData: CptData;
  axisLimits: AxisLimits;
  rangeBottom: [number, number];
  rangeTop: [number, number];
}): Series[] {
  const requested = channels.length ? channels : Object.keys(channelDefaults);

  return requested
    .map((channel, index) => {
      const merged = resolveChannel(channel, d3.schemeTableau10[index % 10]);

      return {
        ...merged,
        values: cptData[merged.key],
        x: makeXScale(
          cptData[merged.key],
          merged.side === "top" ? rangeTop : rangeBottom,
          axisLimits[merged.key],
        ),
      };
    })
    .filter((s): s is Series => s.x !== null);
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
