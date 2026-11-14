import { create } from "zustand";
import type { HeatMetric } from "./types";

/**
 * View state shared by the panel, map and forecast dock. Kept outside React
 * state so the slider can update 60×/s and only the subscribers that read
 * ``hour`` re-render.
 */
interface ViewState {
  selectedRouteId: string | null;
  hour: number; // hours since the departure hour, fractional, 0–48
  playing: boolean;
  metric: HeatMetric;
  showHeatmap: boolean;
  showCheckpoints: boolean;
  /** Route mile being scrubbed on a route strip (drives a map marker). */
  scrub: { routeId: string; mile: number } | null;
  /** Checkpoint focused from the table or map. */
  focus: { routeId: string; index: number } | null;
  setSelected: (id: string | null) => void;
  setHour: (h: number) => void;
  setPlaying: (p: boolean) => void;
  setMetric: (m: HeatMetric) => void;
  setShowHeatmap: (v: boolean) => void;
  setShowCheckpoints: (v: boolean) => void;
  setScrub: (s: ViewState["scrub"]) => void;
  setFocus: (f: ViewState["focus"]) => void;
  reset: (selected: string | null) => void;
}

export const useView = create<ViewState>((set) => ({
  selectedRouteId: null,
  hour: 0,
  playing: false,
  metric: "risk",
  showHeatmap: true,
  showCheckpoints: true,
  scrub: null,
  focus: null,
  setSelected: (selectedRouteId) => set({ selectedRouteId, focus: null }),
  setHour: (hour) => set({ hour }),
  setPlaying: (playing) => set({ playing }),
  setMetric: (metric) => set({ metric }),
  setShowHeatmap: (showHeatmap) => set({ showHeatmap }),
  setShowCheckpoints: (showCheckpoints) => set({ showCheckpoints }),
  setScrub: (scrub) => set({ scrub }),
  setFocus: (focus) => set({ focus }),
  reset: (selectedRouteId) => set({ selectedRouteId, hour: 0, playing: false, scrub: null, focus: null }),
}));
