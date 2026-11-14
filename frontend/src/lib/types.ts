// Mirrors the payload built by backend/planner/services/plan.py.

export type RiskKey = "low" | "moderate" | "high" | "severe" | "no_travel";
export type Interval = 10 | 25 | 50;

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface PlanInput {
  origin: Place;
  destination: Place;
  departure: string; // ISO, UTC
  load_lb: number;
  interval_mi: Interval;
  hos: boolean;
}

export interface Checkpoint {
  i: number;
  mile: number;
  lat: number;
  lon: number;
  eta: string;
  elapsed_s: number;
  segment_mi: number;
  wind_mph: number;
  gust_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  risk: RiskKey;
  factors: { wind: RiskKey; rain: RiskKey; snow: RiskKey };
  load_escalated: boolean;
  reason: string;
}

export interface RestStop {
  kind: "break" | "off_duty";
  mile: number;
  lat: number;
  lon: number;
  start: string;
  duration_min: number;
}

export interface RouteSummary {
  distance_mi: number;
  drive_time_s: number;
  trip_time_s: number;
  arrival: string;
  miles_by_level: Record<RiskKey, number>;
  avg_risk: number;
  max_risk: RiskKey;
  checkpoint_count: number;
}

export interface RouteResult {
  id: "A" | "B" | "C";
  name: string;
  roads: string[];
  provider: string;
  profile: string;
  geometry: [number, number][]; // [lon, lat]
  geometry_miles: number[];
  timeline: [number, number][]; // [elapsed seconds, mile]
  checkpoints: Checkpoint[];
  rest_stops: RestStop[];
  summary: RouteSummary;
  rank: number;
  recommended: boolean;
}

export interface Heatmap {
  start: string;
  hours: number;
  step_deg: number;
  nx: number;
  ny: number;
  bounds: [number, number, number, number];
  cells: [number, number][]; // [col, row], row 0 = south
  risk: number[];
  wind_mph: number[];
  rain_hundredths: number[];
  snow_hundredths: number[];
}

export interface PlanResult {
  request: Omit<PlanInput, "departure"> & { departure: string };
  generated_at: string;
  routes: RouteResult[];
  recommendation: {
    route_id: string;
    order: string[];
    decided_by: "no_travel" | "severe" | "high" | "avg_risk" | "time" | null;
    reason: string;
  };
  heatmap: Heatmap;
  warnings: string[];
  timing_ms: { routing: number; weather: number; compute: number };
}

export interface RulesTable {
  levels: RiskKey[];
  conditions: { key: string; unit: string; bands: string[] }[];
  load_rules: string[];
}

export type HeatMetric = "risk" | "wind" | "rain" | "snow";
