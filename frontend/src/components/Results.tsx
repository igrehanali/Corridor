import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { dayClock, duration, miles } from "../lib/format";
import { useView } from "../lib/store";
import type { PlanResult, RouteResult } from "../lib/types";
import { CheckpointTable } from "./CheckpointTable";
import { RiskPill } from "./RiskPill";
import { RiskBar, RouteStrip } from "./RouteVisuals";
import { Icon, spring } from "./ui";

const CRITERIA: { key: NonNullable<PlanResult["recommendation"]["decided_by"]>; label: string }[] = [
  { key: "no_travel", label: "No Travel miles" },
  { key: "severe", label: "Severe miles" },
  { key: "high", label: "High miles" },
  { key: "avg_risk", label: "Avg. risk" },
  { key: "time", label: "Travel time" },
];

export function Results({ plan, stale }: { plan: PlanResult; stale: boolean }) {
  const selectedId = useView((s) => s.selectedRouteId);
  const setSelected = useView((s) => s.setSelected);
  const ordered = plan.recommendation.order.map((id) => plan.routes.find((r) => r.id === id)!);

  return (
    <div className={`results${stale ? " is-stale" : ""}`} aria-busy={stale}>
      {plan.warnings.map((w) => (
        <div className="banner banner--warn" key={w} role="status">
          <Icon name="alert" size={16} />
          <span>{w}</span>
        </div>
      ))}
      <Recommendation plan={plan} />
      <div className="section-head">
        <h2>Routes</h2>
        <span className="muted">Ranked by the rules below</span>
      </div>
      <div className="route-list">
        {ordered.map((r) => (
          <RouteCard
            key={r.id}
            route={r}
            selected={(selectedId ?? plan.recommendation.route_id) === r.id}
            onSelect={() => setSelected(r.id)}
            fastestTrip={Math.min(...plan.routes.map((x) => x.summary.trip_time_s))}
          />
        ))}
      </div>
      <p className="sources">
        Weather: Open-Meteo forecast · Routing: {Array.from(new Set(plan.routes.map((r) => r.provider))).join(", ")}{" "}
        · Planned in {((plan.timing_ms.routing + plan.timing_ms.weather + plan.timing_ms.compute) / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

function Recommendation({ plan }: { plan: PlanResult }) {
  const rec = plan.recommendation;
  const route = plan.routes.find((r) => r.id === rec.route_id)!;
  return (
    <section className="rec" aria-label="Recommendation">
      <div className="rec__eyebrow">
        <Icon name="check" size={14} /> Recommended
      </div>
      <h2 className="rec__title">
        Route {route.id} <span className="rec__via">via {route.name}</span>
      </h2>
      <p className="rec__reason">{rec.reason}</p>
      <div className="rec__stats">
        <Stat label="Arrive" value={dayClock(route.summary.arrival, plan.request.departure)} />
        <Stat label="Trip time" value={duration(route.summary.trip_time_s)} />
        <Stat label="Worst" value={<RiskPill risk={route.summary.max_risk} />} />
      </div>
      {rec.decided_by && (
        <ol className="ladder" aria-label="Decision order">
          {CRITERIA.map((c, i) => {
            const decidedAt = CRITERIA.findIndex((x) => x.key === rec.decided_by);
            const state = i < decidedAt ? "tied" : i === decidedAt ? "decided" : "unused";
            return (
              <li key={c.key} className={`ladder__step is-${state}`} title={state === "tied" ? "Tied" : undefined}>
                {c.label}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

function RouteCard({
  route,
  selected,
  onSelect,
  fastestTrip,
}: {
  route: RouteResult;
  selected: boolean;
  onSelect: () => void;
  fastestTrip: number;
}) {
  const [open, setOpen] = useState(false);
  const s = route.summary;
  const extra = s.trip_time_s - fastestTrip;
  return (
    <motion.article
      layout="position"
      transition={spring}
      className={`route-card${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Route ${route.id} via ${route.name}`}
    >
      <header className="route-card__head">
        <span className="route-badge">{route.id}</span>
        <div className="route-card__title">
          <span className="route-card__name">{route.name}</span>
          <span className="route-card__meta">
            {miles(s.distance_mi)} · {duration(s.drive_time_s)} driving
            {route.profile !== "truck" && <span title={`Routing profile: ${route.profile}`}> · car-based</span>}
          </span>
        </div>
        {route.recommended ? <span className="tag tag--rec">Best</span> : <span className="tag">#{route.rank}</span>}
      </header>

      <div className="route-card__numbers">
        <div>
          <span className="stat__label">Arrive</span>
          <span className="stat__value">{dayClock(s.arrival)}</span>
        </div>
        <div>
          <span className="stat__label">Trip</span>
          <span className="stat__value">
            {duration(s.trip_time_s)}
            {extra > 60 && <span className="delta">+{duration(extra)}</span>}
          </span>
        </div>
        <div>
          <span className="stat__label">Avg. risk</span>
          <span className="stat__value">{s.avg_risk.toFixed(2)}</span>
        </div>
      </div>

      <RiskBar route={route} />

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            className="route-card__detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <RouteStrip route={route} />
            {route.rest_stops.length > 0 && (
              <p className="route-card__hos">
                <Icon name="clock" size={14} /> {restSummary(route)}
              </p>
            )}
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name="chevron" size={14} className={open ? "rot-90" : undefined} />
              {open ? "Hide" : "Show"} {route.checkpoints.length} checkpoints
            </button>
            {open && <CheckpointTable route={route} />}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function restSummary(route: RouteResult): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const off = route.rest_stops.filter((r) => r.kind === "off_duty").length;
  const breaks = route.rest_stops.length - off;
  const parts = [off && plural(off, "10 h rest"), breaks && plural(breaks, "30 min break")].filter(Boolean);
  return `HOS: ${parts.join(" and ")} included in the ETA`;
}
