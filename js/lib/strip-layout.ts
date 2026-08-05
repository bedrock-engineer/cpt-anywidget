import * as d3 from "./d3";

export interface StripLayout {
  /** the sorted input chainages, echoed for downstream consumers */
  distances: number[];
  /** chainage extent, distances[n-1] - distances[0] */
  span: number;
  /** runs of tied chainages; a run's members dodge around its anchor */
  groups: { dist: number; idx: number[] }[];
  /** grows past the requested width when the strips need the room */
  svgWidth: number;
  /** the svg width when equal-spaced: the requested width unless the
      strip count alone needs more. Narrower than svgWidth whenever the
      chainage spread forced true scale to grow */
  equalSvgWidth: number;
  /** x of the leftmost/rightmost possible strip center */
  innerLeft: number;
  innerRight: number;
  anchorX: (d: number) => number;
  trueCenters: number[];
  equalCenters: number[];
  /** chainage → px for the profile-space overlays: linear in true scale,
      piecewise-linear between the strip anchors when equal-spaced — an
      overlay point between two strips stays between them in both modes.
      Rebuild whenever the active centers change */
  distToX(centers: number[]): (d: number) => number;
}

interface StripLayoutProps {
  /** chainages in strip order, sorted ascending, ties allowed */
  distances: number[];
  stripWidth: number;
  stripGap: number;
  /** the requested plot width; svgWidth grows past it when needed */
  width: number;
  marginLeft: number;
  marginRight: number;
}

export function stripLayout({
  distances,
  stripWidth,
  stripGap,
  width,
  marginLeft,
  marginRight,
}: StripLayoutProps): StripLayout {
  const n = distances.length;
  const span = distances[n - 1] - distances[0];
  const pitch = stripWidth + stripGap;

  // runs of tied chainages; a run's members dodge around its anchor
  const groups: { dist: number; idx: number[] }[] = [];
  distances.forEach((d, i) => {
    const last = groups[groups.length - 1];
    if (last && last.dist === d) {
      last.idx.push(i);
    } else {
      groups.push({ dist: d, idx: [i] });
    }
  });
  const halfExtent = (g: { idx: number[] }) => ((g.idx.length - 1) * pitch) / 2;

  // the px-per-m floor that keeps adjacent runs clear of each other
  let minScale = 0;
  for (let j = 1; j < groups.length; j += 1) {
    const need = halfExtent(groups[j - 1]) + halfExtent(groups[j]) + pitch;
    minScale = Math.max(minScale, need / (groups[j].dist - groups[j - 1].dist));
  }

  const endPad = halfExtent(groups[0]) + halfExtent(groups[groups.length - 1]);
  const chrome = marginLeft + marginRight + stripWidth;
  const svgWidth = Math.max(
    width,
    Math.ceil(chrome + endPad + minScale * span),
    chrome + (n - 1) * pitch,
  );

  const innerLeft = marginLeft + stripWidth / 2;
  const innerRight = svgWidth - marginRight - stripWidth / 2;
  const mid = (innerLeft + innerRight) / 2;

  const anchorX: (d: number) => number =
    span === 0
      ? () => mid
      : d3
          .scaleLinear()
          .domain([distances[0], distances[n - 1]])
          .range([
            innerLeft + halfExtent(groups[0]),
            innerRight - halfExtent(groups[groups.length - 1]),
          ]);

  const trueCenters: number[] = new Array(n);

  for (const g of groups) {
    const a = anchorX(g.dist);

    g.idx.forEach((i, k) => {
      trueCenters[i] = a + (k - (g.idx.length - 1) / 2) * pitch;
    });
  }

  // equal spacing spreads over the requested width like true scale
  // spreads over the profile, only widening its pitch past that when
  // the strips wouldn't fit
  const equalSpan = Math.max(width - chrome, (n - 1) * pitch);
  const equalSvgWidth = chrome + equalSpan;
  const equalCenters =
    n === 1
      ? [mid]
      : distances.map((_, i) => innerLeft + (i * equalSpan) / (n - 1));

  // a piecewise scale chokes on duplicate domain values, so tied
  // chainages collapse to one domain stop at their centers' mean
  const distToX = (centers: number[]): ((d: number) => number) => {
    const domain: number[] = [];
    const range: number[] = [];
    for (let j = 0; j < n; ) {
      let k = j;
      let sum = 0;
      while (k < n && distances[k] === distances[j]) {
        sum += centers[k];
        k += 1;
      }
      domain.push(distances[j]);
      range.push(sum / (k - j));
      j = k;
    }
    return domain.length >= 2
      ? d3.scaleLinear().domain(domain).range(range)
      : () => mid;
  };

  return {
    distances,
    span,
    groups,
    svgWidth,
    equalSvgWidth,
    innerLeft,
    innerRight,
    anchorX,
    trueCenters,
    equalCenters,
    distToX,
  };
}
