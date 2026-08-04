import type { VerticalSpec } from "./types";

/** a fully resolved vertical binding: every display field filled in */
export type ResolvedVertical = Required<VerticalSpec>;

// built-in display defaults for the two BRO vertical coordinates:
// depth below surface (positive down) and NAP elevation (positive up,
// signed so values near the datum read unambiguously). The Python
// mirror is _DEFAULTS in vertical.py; change them together
export const verticalDefaults: Record<string, Omit<VerticalSpec, "key">> = {
  depth: { label: "depth [m]", up: false, format: ".2f" },
  nap: { label: "NAP [m]", up: true, format: "+.2f" },
};

// resolve the verticalKey trait (a key string or spec dict) against the
// display defaults; unknown keys label as themselves and read as
// depth-like. None from a hand-built Python dict arrives as null, so
// nullish fields are dropped rather than allowed to shadow a default
export function resolveVertical(
  raw: string | VerticalSpec | undefined,
  fallbackKey: string,
): ResolvedVertical {
  const spec =
    !raw ? { key: fallbackKey } : typeof raw === "string" ? { key: raw } : raw;
  return {
    label: spec.key,
    up: false,
    format: ".2f",
    ...verticalDefaults[spec.key],
    ...Object.fromEntries(
      Object.entries(spec).filter(([, v]) => v != null),
    ),
  } as ResolvedVertical;
}
