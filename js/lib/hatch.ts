import type { AnySelection } from "./types";

// matplotlib-style hatch chars (from brodata's BRO lithology table) as 6x6
// SVG pattern tiles — a second visual channel beyond the band colour
const HATCH_STROKE = `stroke="rgba(0,0,0,0.32)" stroke-width="0.8"`;

export const HATCH_SHAPE: Record<string, string> = {
  "-": `<path d="M0,3 L6,3" ${HATCH_STROKE}/>`,
  "/": `<path d="M0,6 L6,0" ${HATCH_STROKE}/>`,
  "\\": `<path d="M0,0 L6,6" ${HATCH_STROKE}/>`,
  "|": `<path d="M3,0 L3,6" ${HATCH_STROKE}/>`,
  ".": `<circle cx="3" cy="3" r="0.9" fill="rgba(0,0,0,0.32)"/>`,
  o: `<circle cx="3" cy="3" r="1.4" fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="0.7"/>`,
};

// one <pattern> def per hatch char used anywhere in the chart; returns
// char → pattern id. Ids are per-call unique: two widgets on one page
// must not share defs
export function hatchDefs(
  svg: AnySelection<SVGSVGElement>,
  chars: string[],
): Map<string, string> {
  const uid = crypto.randomUUID();
  const ids = new Map(chars.map((h, i) => [h, `hatch-${uid}-${i}`]));

  svg
    .append("defs")
    .selectAll("pattern")
    .data(chars)
    .join("pattern")
    .attr("id", (h) => ids.get(h)!)
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternUnits", "userSpaceOnUse")
    .html((h) => HATCH_SHAPE[h]);

  return ids;
}
