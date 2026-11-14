import { useRef } from "react";
import { dayClock, miles } from "../lib/format";
import { RISK_KEYS, RISK_LABEL, riskCss } from "../lib/risk";
import { useView } from "../lib/store";
import type { RouteResult } from "../lib/types";

/** Stacked bar: share of the route's miles at each risk level. */
export function RiskBar({ route }: { route: RouteResult }) {
  const total = route.summary.distance_mi || 1;
  const m = route.summary.miles_by_level;
  const notable = RISK_KEYS.filter((k) => k !== "low" && m[k] > 0).reverse();
  return (
    <div className="riskbar">
      <div className="riskbar__track" role="img" aria-label={RISK_KEYS.map((k) => `${RISK_LABEL[k]} ${miles(m[k])}`).join(", ")}>
        {RISK_KEYS.map((k) =>
          m[k] > 0 ? (
            <span key={k} style={{ width: `${(m[k] / total) * 100}%`, background: riskCss(k) }} title={`${RISK_LABEL[k]}: ${miles(m[k])}`} />
          ) : null,
        )}
      </div>
      <div className="riskbar__legend">
        {notable.length === 0 ? (
          <span className="riskbar__ok">
            <span className="risk-dot" style={{ background: riskCss("low") }} /> Low risk the whole way
          </span>
        ) : (
          notable.map((k) => (
            <span key={k} className="riskbar__item">
              <span className="risk-dot" style={{ background: riskCss(k) }} />
              <strong>{miles(m[k])}</strong> {RISK_LABEL[k].toLowerCase()}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The route as a horizontal strip, coloured by checkpoint risk, with HOS stops.
 * Scrubbing the strip moves a marker along the route on the map.
 */
export function RouteStrip({ route }: { route: RouteResult }) {
  const ref = useRef<HTMLDivElement>(null);
  const setScrub = useView((s) => s.setScrub);
  const scrub = useView((s) => (s.scrub?.routeId === route.id ? s.scrub.mile : null));
  const total = route.summary.distance_mi || 1;
  const cps = route.checkpoints;

  const mileAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };
  const nearest = scrub === null ? null : cps.reduce((a, b) => (Math.abs(b.mile - scrub) < Math.abs(a.mile - scrub) ? b : a));

  return (
    <div className="strip">
      <div
        ref={ref}
        className="strip__track"
        onPointerMove={(e) => setScrub({ routeId: route.id, mile: mileAt(e.clientX) })}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setScrub({ routeId: route.id, mile: mileAt(e.clientX) });
        }}
        onPointerLeave={() => setScrub(null)}
        onPointerUp={(e) => e.pointerType !== "mouse" && setScrub(null)}
        role="img"
        aria-label={`Risk along route ${route.id}`}
      >
        {cps.map((cp, i) => {
          const from = i === 0 ? 0 : (cps[i - 1].mile + cp.mile) / 2;
          const to = i === cps.length - 1 ? total : (cp.mile + cps[i + 1].mile) / 2;
          return (
            <span
              key={cp.i}
              className="strip__seg"
              style={{ left: `${(from / total) * 100}%`, width: `${((to - from) / total) * 100}%`, background: riskCss(cp.risk) }}
            />
          );
        })}
        {route.rest_stops.map((s) => (
          <span
            key={`${s.kind}-${s.mile}`}
            className={`strip__rest strip__rest--${s.kind}`}
            style={{ left: `${(s.mile / total) * 100}%` }}
            title={s.kind === "off_duty" ? "10 h off-duty rest" : "30 min break"}
          />
        ))}
        {scrub !== null && <span className="strip__cursor" style={{ left: `${(scrub / total) * 100}%` }} />}
      </div>
      <div className="strip__axis">
        <span>{dayClock(cps[0].eta)}</span>
        {nearest ? (
          <span className="strip__readout">
            Mile {Math.round(scrub!)} · {dayClock(nearest.eta)} · {RISK_LABEL[nearest.risk]}
          </span>
        ) : (
          <span className="muted">{miles(total)}</span>
        )}
        <span>{dayClock(route.summary.arrival)}</span>
      </div>
    </div>
  );
}
