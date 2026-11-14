import type { Place } from "./types";

export interface ExampleTrip {
  title: string;
  note: string;
  origin: Place;
  destination: Place;
  load_lb: number;
}

export const EXAMPLES: ExampleTrip[] = [
  {
    title: "Denver → Salt Lake City",
    note: "Rockies · high-wind corridors",
    origin: { label: "Denver, Colorado", lat: 39.7392, lon: -104.9903 },
    destination: { label: "Salt Lake City, Utah", lat: 40.7608, lon: -111.891 },
    load_lb: 42_000,
  },
  {
    title: "Seattle → Boise",
    note: "Cascade passes · snow",
    origin: { label: "Seattle, Washington", lat: 47.6062, lon: -122.3321 },
    destination: { label: "Boise, Idaho", lat: 43.615, lon: -116.2023 },
    load_lb: 35_000,
  },
  {
    title: "Chicago → Minneapolis",
    note: "Upper Midwest · lake effect",
    origin: { label: "Chicago, Illinois", lat: 41.8781, lon: -87.6298 },
    destination: { label: "Minneapolis, Minnesota", lat: 44.9778, lon: -93.265 },
    load_lb: 28_000,
  },
  {
    title: "Dallas → Atlanta",
    note: "I-20 vs I-30 · storms",
    origin: { label: "Dallas, Texas", lat: 32.7767, lon: -96.797 },
    destination: { label: "Atlanta, Georgia", lat: 33.749, lon: -84.388 },
    load_lb: 44_000,
  },
];
