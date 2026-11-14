/**
 * Heatmap rasterisation.
 *
 * The backend samples weather on a regular lat/lon lattice around the routes.
 * We paint one pixel per lattice cell into a tiny RGBA image (≈ 40×20 px) and
 * hand it to a deck.gl BitmapLayer, which stretches it over the corridor with
 * bilinear filtering on the GPU. Scrubbing the slider repaints ~200 pixels and
 * swaps one small texture, so it stays at 60 fps on any device.
 *
 * Fractional hours cross-fade between the two neighbouring forecast hours,
 * which is what makes playback look continuous rather than stepping.
 */
import { RISK_KEYS, RISK_RGB } from "./risk";
import type { HeatMetric, Heatmap } from "./types";

type RGBA = [number, number, number, number];
type Ramp = [number, RGBA][];

const rgb = (k: keyof typeof RISK_RGB, a: number): RGBA => [...RISK_RGB[k], a];

// Alpha per risk level: calm corridor stays faintly visible; hazards dominate.
const RISK_ALPHA = [40, 150, 175, 195, 215];
const RISK_RGBA: RGBA[] = RISK_KEYS.map((k, i) => rgb(k, RISK_ALPHA[i]));

// Continuous ramps whose colour stops sit exactly on the risk thresholds, so a
// wind/rain/snow map reads in the same colour language as the risk map.
export const RAMPS: Record<Exclude<HeatMetric, "risk">, Ramp> = {
  wind: [
    [0, [96, 165, 220, 0]],
    [10, [96, 165, 220, 45]],
    [20, [70, 150, 210, 95]],
    [25, rgb("moderate", 150)],
    [35, rgb("high", 175)],
    [45, rgb("severe", 195)],
    [55, rgb("no_travel", 215)],
  ],
  rain: [
    [0, [70, 130, 230, 0]],
    [0.01, [70, 130, 230, 55]],
    [0.05, [50, 110, 220, 115]],
    [0.1, rgb("moderate", 150)],
    [0.25, rgb("high", 175)],
    [0.5, rgb("severe", 195)],
    [1.0, rgb("no_travel", 215)],
  ],
  snow: [
    [0, [150, 160, 250, 0]],
    [0.05, [150, 160, 250, 60]],
    [0.2, [120, 130, 240, 120]],
    [0.5, rgb("moderate", 150)],
    [1.0, rgb("high", 175)],
    [2.0, rgb("severe", 195)],
    [3.0, rgb("no_travel", 215)],
  ],
};

export const METRIC_UNIT: Record<HeatMetric, string> = { risk: "", wind: "mph", rain: "in/hr", snow: "in/hr" };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

export function rampColor(ramp: Ramp, v: number): RGBA {
  if (v <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    const [x1, c1] = ramp[i];
    if (v <= x1) {
      const [x0, c0] = ramp[i - 1];
      return lerpRGBA(c0, c1, (v - x0) / (x1 - x0));
    }
  }
  return ramp[ramp.length - 1][1];
}

/** Metric values for one cell-hour, in display units. */
export function metricValues(hm: Heatmap, metric: HeatMetric): ArrayLike<number> {
  switch (metric) {
    case "risk":
      return hm.risk;
    case "wind":
      return hm.wind_mph;
    case "rain":
      return hm.rain_hundredths.map((v) => v / 100);
    case "snow":
      return hm.snow_hundredths.map((v) => v / 100);
  }
}

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function buildRaster(hm: Heatmap, values: ArrayLike<number>, metric: HeatMetric, hour: number): Raster {
  const { nx, ny, cells, hours } = hm;
  const data = new Uint8ClampedArray(nx * ny * 4);
  const filled = new Uint8Array(nx * ny);
  const h = Math.max(0, Math.min(hours - 1, hour));
  const h0 = Math.floor(h);
  const h1 = Math.min(h0 + 1, hours - 1);
  const t = h - h0;
  for (let c = 0; c < cells.length; c++) {
    const [col, row] = cells[c];
    const v0 = values[c * hours + h0];
    const v1 = values[c * hours + h1];
    const color =
      metric === "risk"
        ? lerpRGBA(RISK_RGBA[v0], RISK_RGBA[v1], t)
        : rampColor(RAMPS[metric], lerp(v0, v1, t));
    const px = (ny - 1 - row) * nx + col; // image row 0 is north
    const o = px * 4;
    data[o] = color[0];
    data[o + 1] = color[1];
    data[o + 2] = color[2];
    data[o + 3] = color[3];
    filled[px] = 1;
  }
  bleedEdges(data, filled, nx, ny);
  return { data, width: nx, height: ny };
}

/**
 * Give empty pixels the colour of a filled neighbour (alpha stays 0) so
 * bilinear filtering fades edges to transparent instead of to dark grey.
 */
function bleedEdges(data: Uint8ClampedArray, filled: Uint8Array, nx: number, ny: number) {
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const p = y * nx + x;
      if (filled[p]) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const q = yy * nx + xx;
        if (!filled[q]) continue;
        data[p * 4] = data[q * 4];
        data[p * 4 + 1] = data[q * 4 + 1];
        data[p * 4 + 2] = data[q * 4 + 2];
        break;
      }
    }
  }
}

/** Index of the lattice cell under a map coordinate, or -1 outside the corridor. */
export function cellLookup(hm: Heatmap): (lon: number, lat: number) => number {
  const index = new Map<number, number>();
  hm.cells.forEach(([col, row], i) => index.set(row * hm.nx + col, i));
  const west = hm.bounds[0] + hm.step_deg / 2;
  const south = hm.bounds[1] + hm.step_deg / 2;
  return (lon, lat) => {
    const col = Math.round((lon - west) / hm.step_deg);
    const row = Math.round((lat - south) / hm.step_deg);
    if (col < 0 || row < 0 || col >= hm.nx || row >= hm.ny) return -1;
    return index.get(row * hm.nx + col) ?? -1;
  };
}
