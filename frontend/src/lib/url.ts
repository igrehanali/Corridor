import type { Interval, PlanInput } from "./types";

/** Keep the current trip in the URL so a plan can be shared or reloaded. */
export function inputToSearch(p: PlanInput): string {
  const q = new URLSearchParams({
    from: p.origin.label,
    fromLat: p.origin.lat.toFixed(5),
    fromLon: p.origin.lon.toFixed(5),
    to: p.destination.label,
    toLat: p.destination.lat.toFixed(5),
    toLon: p.destination.lon.toFixed(5),
    depart: p.departure,
    load: String(p.load_lb),
    every: String(p.interval_mi),
    hos: p.hos ? "1" : "0",
  });
  return `?${q.toString()}`;
}

export function searchToInput(search: string): PlanInput | null {
  const q = new URLSearchParams(search);
  const num = (k: string) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) && q.get(k) !== null ? v : null;
  };
  const fromLat = num("fromLat");
  const fromLon = num("fromLon");
  const toLat = num("toLat");
  const toLon = num("toLon");
  const load = num("load");
  const every = num("every");
  const depart = q.get("depart");
  if ([fromLat, fromLon, toLat, toLon, load].some((v) => v === null) || !depart) return null;
  if (Number.isNaN(Date.parse(depart))) return null;
  return {
    origin: { label: q.get("from") ?? "Origin", lat: fromLat!, lon: fromLon! },
    destination: { label: q.get("to") ?? "Destination", lat: toLat!, lon: toLon! },
    departure: depart,
    load_lb: load!,
    interval_mi: ([10, 25, 50].includes(every ?? 25) ? every : 25) as Interval,
    hos: q.get("hos") !== "0",
  };
}
