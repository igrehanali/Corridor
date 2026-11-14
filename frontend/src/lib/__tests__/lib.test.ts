import { describe, expect, it } from "vitest";
import { pointAtMile, riskSegments, truckAt } from "../geo";
import { buildRaster, cellLookup, rampColor, RAMPS } from "../heatmap";
import type { Heatmap, RouteResult } from "../types";
import { inputToSearch, searchToInput } from "../url";

function route(): RouteResult {
  return {
    id: "A",
    name: "I-80",
    roads: ["I-80"],
    provider: "valhalla",
    profile: "truck",
    geometry: [
      [-100, 40],
      [-99, 40],
      [-98, 40],
    ],
    geometry_miles: [0, 50, 100],
    // 50 mi in 1 h, then a 30 min stop at mile 50, then 50 mi in 1 h
    timeline: [
      [0, 0],
      [3600, 50],
      [5400, 50],
      [9000, 100],
    ],
    checkpoints: [0, 25, 50, 75, 100].map((mile, i) => ({
      i,
      mile,
      lat: 40,
      lon: -100 + mile / 50,
      eta: "",
      elapsed_s: 0,
      segment_mi: 25,
      wind_mph: 0,
      gust_mph: 0,
      rain_in_hr: 0,
      snow_in_hr: 0,
      risk: i === 2 || i === 3 ? "severe" : "low",
      factors: { wind: "low", rain: "low", snow: "low" },
      load_escalated: false,
      reason: "",
    })),
    rest_stops: [],
    summary: {
      distance_mi: 100,
      drive_time_s: 7200,
      trip_time_s: 9000,
      arrival: "",
      miles_by_level: { low: 50, moderate: 0, high: 0, severe: 50, no_travel: 0 },
      avg_risk: 1.5,
      max_risk: "severe",
      checkpoint_count: 5,
    },
    rank: 1,
    recommended: true,
  };
}

describe("geo", () => {
  it("interpolates a point by mile", () => {
    expect(pointAtMile(route(), 25)).toEqual([-99.5, 40]);
    expect(pointAtMile(route(), 500)).toEqual([-98, 40]);
  });

  it("holds the truck still during an HOS stop", () => {
    const r = route();
    expect(truckAt(r, 1800).mile).toBeCloseTo(25);
    expect(truckAt(r, 4500)).toMatchObject({ mile: 50, status: "resting" });
    expect(truckAt(r, 7200).mile).toBeCloseTo(75);
    expect(truckAt(r, 99999).status).toBe("arrived");
    expect(truckAt(r, -5).status).toBe("waiting");
  });

  it("merges equal-risk neighbours and splits at checkpoint midpoints", () => {
    const segs = riskSegments(route());
    expect(segs.map((s) => [s.risk, s.from, s.to])).toEqual([
      ["low", 0, 37.5],
      ["severe", 37.5, 87.5],
      ["low", 87.5, 100],
    ]);
  });
});

describe("heatmap", () => {
  const hm: Heatmap = {
    start: "2026-01-01T00:00:00Z",
    hours: 2,
    step_deg: 1,
    nx: 2,
    ny: 2,
    bounds: [-100.5, 39.5, -98.5, 41.5],
    cells: [
      [0, 0],
      [1, 1],
    ],
    risk: [0, 4, 3, 3],
    wind_mph: [0, 0, 0, 0],
    rain_hundredths: [0, 0, 0, 0],
    snow_hundredths: [0, 0, 0, 0],
  };

  it("puts row 0 (south) at the bottom of the image and leaves gaps transparent", () => {
    const r = buildRaster(hm, hm.risk, "risk", 0);
    const alpha = (x: number, y: number) => r.data[(y * 2 + x) * 4 + 3];
    expect(alpha(0, 1)).toBeGreaterThan(0); // cell (0,0) → bottom-left
    expect(alpha(1, 0)).toBeGreaterThan(0); // cell (1,1) → top-right
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(1, 1)).toBe(0);
  });

  it("cross-fades between forecast hours", () => {
    const a = buildRaster(hm, hm.risk, "risk", 0).data[(1 * 2 + 0) * 4 + 3];
    const b = buildRaster(hm, hm.risk, "risk", 1).data[(1 * 2 + 0) * 4 + 3];
    const mid = buildRaster(hm, hm.risk, "risk", 0.5).data[(1 * 2 + 0) * 4 + 3];
    expect(mid).toBeGreaterThan(a);
    expect(mid).toBeLessThan(b);
  });

  it("looks up cells by coordinate", () => {
    const find = cellLookup(hm);
    expect(find(-100, 40)).toBe(0);
    expect(find(-99, 41)).toBe(1);
    expect(find(-99, 40)).toBe(-1);
    expect(find(-120, 40)).toBe(-1);
  });

  it("wind ramp hits the risk colour exactly at thresholds", () => {
    expect(rampColor(RAMPS.wind, 45)).toEqual(RAMPS.wind[5][1]);
    expect(rampColor(RAMPS.wind, 99)).toEqual(RAMPS.wind[6][1]);
  });
});

describe("url", () => {
  it("round-trips a plan input", () => {
    const input = {
      origin: { label: "Denver, Colorado", lat: 39.7392, lon: -104.9903 },
      destination: { label: "Salt Lake City, Utah", lat: 40.7608, lon: -111.891 },
      departure: "2026-11-14T16:00:00.000Z",
      load_lb: 42000,
      interval_mi: 10 as const,
      hos: false,
    };
    expect(searchToInput(inputToSearch(input))).toEqual(input);
  });

  it("rejects incomplete links", () => {
    expect(searchToInput("?from=Denver")).toBeNull();
  });
});
