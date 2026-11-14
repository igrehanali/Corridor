import { RISK_LABEL, riskCss } from "../lib/risk";
import type { RiskKey } from "../lib/types";

export function RiskPill({ risk, size = "sm" }: { risk: RiskKey; size?: "sm" | "md" }) {
  return (
    <span
      className={`risk-pill risk-pill--${size}`}
      style={{ background: riskCss(risk, 0.14), color: risk === "moderate" ? "#8a6400" : riskCss(risk) }}
    >
      <span className="risk-dot" style={{ background: riskCss(risk) }} aria-hidden />
      {RISK_LABEL[risk]}
    </span>
  );
}
