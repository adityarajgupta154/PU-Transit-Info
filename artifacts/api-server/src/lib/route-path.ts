// RTE-01: a route may claim provider road geometry (pathSource "ors") only if
// that geometry actually passes each stop; otherwise a stale or endpoint-only
// path would be published as if every leg were routed.

type Point = { lat: number; lng: number };

export const STOP_TOLERANCE_METRES = 150;
const EARTH_RADIUS_METRES = 6_371_000;

/** Distance from `p` to segment `a`–`b`, in metres, on a local flat projection (fine at city scale). */
function metresToSegment(p: Point, a: Point, b: Point): number {
  const scale = Math.cos((p.lat * Math.PI) / 180);
  const toXY = (point: Point) => ({
    x: ((point.lng - p.lng) * Math.PI / 180) * scale * EARTH_RADIUS_METRES,
    y: ((point.lat - p.lat) * Math.PI / 180) * EARTH_RADIUS_METRES,
  });
  const A = toXY(a);
  const B = toXY(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / lengthSquared));
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

/** Stops farther than the tolerance from the whole polyline, with their distance. */
export function offPathStops(
  stops: (Point & { name?: string })[],
  path: Point[],
  tolerance = STOP_TOLERANCE_METRES,
): { index: number; name: string; metres: number }[] {
  if (path.length < 2) return stops.map((stop, index) => ({ index, name: stop.name ?? `stop ${index + 1}`, metres: Infinity }));
  const off: { index: number; name: string; metres: number }[] = [];
  stops.forEach((stop, index) => {
    let best = Infinity;
    for (let i = 1; i < path.length && best > tolerance; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      if (a && b) best = Math.min(best, metresToSegment(stop, a, b));
    }
    if (best > tolerance) off.push({ index, name: stop.name ?? `stop ${index + 1}`, metres: Math.round(best) });
  });
  return off;
}
