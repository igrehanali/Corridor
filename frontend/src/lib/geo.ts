import type { RiskKey, RouteResult } from "./types";

/** Largest index i with xs[i] <= x (xs ascending). */
function floorIndex(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function pointAtMile(route: RouteResult, mile: number): [number, number] {
  const ms = route.geometry_miles;
  const g = route.geometry;
  if (mile <= 0) return g[0];
  if (mile >= ms[ms.length - 1]) return g[g.length - 1];
  const i = floorIndex(ms, mile);
  const span = ms[i + 1] - ms[i];
  const t = span > 0 ? (mile - ms[i]) / span : 0;
  return [g[i][0] + (g[i + 1][0] - g[i][0]) * t, g[i][1] + (g[i + 1][1] - g[i][1]) * t];
}

const timesCache = new WeakMap<RouteResult, Float64Array>();
function timelineTimes(route: RouteResult): Float64Array {
  let t = timesCache.get(route);
  if (!t) {
    t = Float64Array.from(route.timeline, (p) => p[0]);
    timesCache.set(route, t);
  }
  return t;
}

export interface TruckState {
  position: [number, number];
  mile: number;
  status: "waiting" | "driving" | "resting" | "arrived";
}

/** Where the truck is ``elapsedS`` seconds after departure (HOS rests included). */
export function truckAt(route: RouteResult, elapsedS: number): TruckState {
  const tl = route.timeline;
  const last = tl[tl.length - 1];
  if (elapsedS <= 0) return { position: route.geometry[0], mile: 0, status: "waiting" };
  if (elapsedS >= last[0]) return { position: pointAtMile(route, last[1]), mile: last[1], status: "arrived" };
  const i = floorIndex(timelineTimes(route), elapsedS);
  const [t0, m0] = tl[i];
  const [t1, m1] = tl[Math.min(i + 1, tl.length - 1)];
  const t = t1 > t0 ? (elapsedS - t0) / (t1 - t0) : 0;
  const mile = m0 + (m1 - m0) * t;
  const resting = m1 === m0 && t1 > t0 && t1 - t0 >= 15 * 60;
  return { position: pointAtMile(route, mile), mile, status: resting ? "resting" : "driving" };
}

export function boundsOf(routes: RouteResult[]): [[number, number], [number, number]] {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const r of routes)
    for (const [lon, lat] of r.geometry) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  return [
    [w, s],
    [e, n],
  ];
}

/** Geometry between two route miles, endpoints interpolated. */
export function sliceByMiles(route: RouteResult, from: number, to: number): [number, number][] {
  const ms = route.geometry_miles;
  const out: [number, number][] = [pointAtMile(route, from)];
  for (let i = floorIndex(ms, from) + 1; i < ms.length && ms[i] < to; i++) out.push(route.geometry[i]);
  out.push(pointAtMile(route, to));
  return out;
}

export interface RiskSegment {
  path: [number, number][];
  risk: RiskKey;
  from: number;
  to: number;
}

/**
 * The route split into stretches coloured by the risk of the checkpoint that
 * represents them (each checkpoint covers half the gap to its neighbours —
 * the same miles the backend counts). Adjacent stretches of equal risk merge.
 */
export function riskSegments(route: RouteResult): RiskSegment[] {
  const cps = route.checkpoints;
  const total = route.summary.distance_mi;
  const segs: RiskSegment[] = [];
  cps.forEach((cp, i) => {
    const from = i === 0 ? 0 : (cps[i - 1].mile + cp.mile) / 2;
    const to = i === cps.length - 1 ? total : (cp.mile + cps[i + 1].mile) / 2;
    const prev = segs[segs.length - 1];
    if (prev && prev.risk === cp.risk) prev.to = to;
    else segs.push({ path: [], risk: cp.risk, from, to });
  });
  for (const s of segs) s.path = sliceByMiles(route, s.from, s.to);
  return segs;
}
