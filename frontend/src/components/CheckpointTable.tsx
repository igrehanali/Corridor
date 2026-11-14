import { useEffect, useRef } from "react";
import { dayClock } from "../lib/format";
import { useView } from "../lib/store";
import type { RouteResult } from "../lib/types";
import { RiskPill } from "./RiskPill";

export function CheckpointTable({ route }: { route: RouteResult }) {
  const focus = useView((s) => (s.focus?.routeId === route.id ? s.focus.index : null));
  const setFocus = useView((s) => s.setFocus);
  const setScrub = useView((s) => s.setScrub);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // Clicking a checkpoint on the map scrolls its row into view.
  useEffect(() => {
    if (focus === null) return;
    bodyRef.current?.querySelector(`[data-i="${focus}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const departure = route.checkpoints[0]?.eta;
  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            <th scope="col">Mile</th>
            <th scope="col">ETA</th>
            <th scope="col" className="num">
              Wind
            </th>
            <th scope="col" className="num">
              Rain
            </th>
            <th scope="col" className="num">
              Snow
            </th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {route.checkpoints.map((c) => (
            <tr
              key={c.i}
              data-i={c.i}
              className={focus === c.i ? "is-focused" : undefined}
              onClick={() => setFocus({ routeId: route.id, index: c.i })}
              onMouseEnter={() => setScrub({ routeId: route.id, mile: c.mile })}
              onMouseLeave={() => setScrub(null)}
              title={c.reason}
            >
              <td>{c.mile.toFixed(0)}</td>
              <td>{dayClock(c.eta, departure)}</td>
              <td className="num">
                {c.wind_mph.toFixed(0)}
                <span className="unit"> mph</span>
              </td>
              <td className="num">{c.rain_in_hr.toFixed(2)}</td>
              <td className="num">{c.snow_in_hr.toFixed(2)}</td>
              <td>
                <RiskPill risk={c.risk} />
                {c.load_escalated && (
                  <span className="load-flag" title="Escalated by the load-weight rule">
                    LOAD
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cp-table__note">Rain and snow in in/hr. Each checkpoint covers half the distance to its neighbours.</p>
    </div>
  );
}
