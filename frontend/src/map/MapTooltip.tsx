import { dayClock, duration, miles } from "../lib/format";
import type { TruckState } from "../lib/geo";
import { RISK_KEYS, RISK_LABEL } from "../lib/risk";
import type { Checkpoint, Heatmap, RestStop, RouteResult } from "../lib/types";
import { RiskPill } from "../components/RiskPill";

export type HoverInfo = { x: number; y: number } & (
  | { kind: "checkpoint"; checkpoint: Checkpoint }
  | { kind: "rest"; rest: RestStop }
  | { kind: "truck"; route: RouteResult; state: TruckState; elapsedS: number }
  | { kind: "route"; route: RouteResult }
  | { kind: "cell"; cell: number; heatmap: Heatmap; load: number }
);

const STATUS: Record<TruckState["status"], string> = {
  waiting: "Not departed yet",
  driving: "Driving",
  resting: "On HOS rest",
  arrived: "Arrived",
};

export function MapTooltip({ info, hour }: { info: HoverInfo; hour: number }) {
  return (
    <div className="map-tooltip" style={{ transform: `translate(${info.x + 14}px, ${info.y + 14}px)` }} role="tooltip">
      <Body info={info} hour={hour} />
    </div>
  );
}

function Body({ info, hour }: { info: HoverInfo; hour: number }) {
  switch (info.kind) {
    case "checkpoint": {
      const c = info.checkpoint;
      return (
        <>
          <div className="tt-head">
            <span>Mile {c.mile.toFixed(0)}</span>
            <RiskPill risk={c.risk} />
          </div>
          <div className="tt-sub">ETA {dayClock(c.eta)}</div>
          <dl className="tt-grid">
            <dt>Wind</dt>
            <dd>
              {c.wind_mph.toFixed(0)} mph <span className="muted">gust {c.gust_mph.toFixed(0)}</span>
            </dd>
            <dt>Rain</dt>
            <dd>{c.rain_in_hr.toFixed(2)} in/hr</dd>
            <dt>Snow</dt>
            <dd>{c.snow_in_hr.toFixed(2)} in/hr</dd>
          </dl>
          <div className="tt-reason">{c.reason}</div>
        </>
      );
    }
    case "rest":
      return (
        <>
          <div className="tt-head">
            <span>{info.rest.kind === "off_duty" ? "10-hour off-duty rest" : "30-minute break"}</span>
          </div>
          <div className="tt-sub">
            Mile {info.rest.mile.toFixed(0)} · starts {dayClock(info.rest.start)}
          </div>
          <div className="tt-reason">Required by hours-of-service rules</div>
        </>
      );
    case "truck":
      return (
        <>
          <div className="tt-head">
            <span>Route {info.route.id} truck</span>
          </div>
          <div className="tt-sub">
            {STATUS[info.state.status]} · mile {info.state.mile.toFixed(0)} of{" "}
            {info.route.summary.distance_mi.toFixed(0)}
          </div>
          {info.elapsedS > 0 && <div className="tt-reason">{duration(info.elapsedS)} after departure</div>}
        </>
      );
    case "route":
      return (
        <>
          <div className="tt-head">
            <span>
              Route {info.route.id} · {info.route.name}
            </span>
          </div>
          <div className="tt-sub">
            {miles(info.route.summary.distance_mi)} · {duration(info.route.summary.trip_time_s)} · click to select
          </div>
        </>
      );
    case "cell": {
      const hm = info.heatmap;
      const h = Math.min(hm.hours - 1, Math.round(hour));
      const i = info.cell * hm.hours + h;
      const risk = RISK_KEYS[hm.risk[i]];
      return (
        <>
          <div className="tt-head">
            <span>Forecast {dayClock(new Date(Date.parse(hm.start) + h * 3600_000))}</span>
            <RiskPill risk={risk} />
          </div>
          <dl className="tt-grid">
            <dt>Wind</dt>
            <dd>{hm.wind_mph[i]} mph</dd>
            <dt>Rain</dt>
            <dd>{(hm.rain_hundredths[i] / 100).toFixed(2)} in/hr</dd>
            <dt>Snow</dt>
            <dd>{(hm.snow_hundredths[i] / 100).toFixed(2)} in/hr</dd>
          </dl>
          <div className="tt-reason">
            {RISK_LABEL[risk]} for a {Math.round(info.load).toLocaleString()} lb load
          </div>
        </>
      );
    }
  }
}
