// geometry of the soil-class pie. The d3.pie layout is the single
// source of the angular contract — wedgeAt reads containment straight
// from the arc datums, so the gesture can never disagree with the
// drawing. d3.arc measures angles from 12 o'clock, increasing
// clockwise: the same convention as a screen bearing.

/** the slice of an arc datum wedgeAt reads — d3.PieArcDatum satisfies it */
export interface ArcAngles {
  startAngle: number;
  endAngle: number;
}

/** pie layout angles putting the first wedge's center on 12 o'clock */
export function pieAngles(count: number): { startAngle: number; endAngle: number } {
  const half = Math.PI / count;
  return { startAngle: -half, endAngle: 2 * Math.PI - half };
}

/** index of the arc whose wedge contains the (dx, dy) bearing from
    the pie center, or null inside the dead zone. Past the dead zone
    only direction matters — a flick anywhere along a wedge's bearing
    picks it */
export function wedgeAt(
  arcs: ArcAngles[],
  dx: number,
  dy: number,
  deadZone: number,
): number | null {
  if (Math.hypot(dx, dy) < deadZone) {
    return null;
  }

  const tau = 2 * Math.PI;
  const bearing = Math.atan2(dx, -dy); // 0 at 12 o'clock, clockwise

  const index = arcs.findIndex(
    (a) => (((bearing - a.startAngle) % tau) + tau) % tau < a.endAngle - a.startAngle,
  );

  return index === -1 ? null : index;
}
