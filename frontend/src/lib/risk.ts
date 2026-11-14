import type { RiskKey } from "./types";

export const RISK_KEYS: RiskKey[] = ["low", "moderate", "high", "severe", "no_travel"];

export const RISK_LABEL: Record<RiskKey, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
  no_travel: "No Travel",
};

// Ordered, perceptually stepped scale. No Travel is a deep magenta so it stays
// distinct from Severe red for colour-blind users (also labelled everywhere).
export const RISK_RGB: Record<RiskKey, [number, number, number]> = {
  low: [52, 178, 125],
  moderate: [242, 190, 34],
  high: [247, 129, 31],
  severe: [224, 49, 61],
  no_travel: [150, 30, 140],
};

export const riskIndex = (k: RiskKey) => RISK_KEYS.indexOf(k);
export const riskCss = (k: RiskKey, alpha = 1) => {
  const [r, g, b] = RISK_RGB[k];
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
};
