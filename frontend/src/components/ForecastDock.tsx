import { useEffect, useMemo } from "react";
import { dayClock, duration } from "../lib/format";
import { RAMPS } from "../lib/heatmap";
import { RISK_KEYS, RISK_LABEL, riskCss } from "../lib/risk";
import { useView } from "../lib/store";
import type { HeatMetric, PlanResult } from "../lib/types";
import { Icon, SegmentedControl } from "./ui";

const PLAY_HOURS_PER_SECOND = 3; // 48 h plays in 16 s

/** Advances the slider with requestAnimationFrame while playing. */
function usePlayback(maxHour: number) {
  const playing = useView((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { hour, setHour, setPlaying } = useView.getState();
      const next = hour + dt * PLAY_HOURS_PER_SECOND;
      if (next >= maxHour) {
        setHour(maxHour);
        setPlaying(false);
        return;
      }
      setHour(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxHour]);
}

export function ForecastDock({ plan }: { plan: PlanResult }) {
  const hm = plan.heatmap;
  const maxHour = hm.hours - 1;
  const hour = useView((s) => s.hour);
  const playing = useView((s) => s.playing);
  const metric = useView((s) => s.metric);
  const showHeatmap = useView((s) => s.showHeatmap);
  const selectedId = useView((s) => s.selectedRouteId) ?? plan.recommendation.route_id;
  const { setHour, setPlaying, setMetric, setShowHeatmap } = useView.getState();
  usePlayback(maxHour);

  const start = Date.parse(hm.start);
  const departOffset = (Date.parse(plan.request.departure) - start) / 3600_000;
  const route = plan.routes.find((r) => r.id === selectedId)!;
  const arriveOffset = departOffset + route.summary.trip_time_s / 3600;
  const current = new Date(start + hour * 3600_000);
  const sinceDeparture = hour - departOffset;

  const ticks = useMemo(() => {
    const out: { h: number; label: string; major: boolean }[] = [];
    for (let h = 0; h <= maxHour; h++) {
      const d = new Date(start + h * 3600_000);
      if (d.getHours() % 6 === 0) {
        const major = d.getHours() === 0;
        out.push({
          h,
          major,
          label: major ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleTimeString(undefined, { hour: "numeric" }),
        });
      }
    }
    return out;
  }, [start, maxHour]);

  // Space toggles playback when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== "Space" || /INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName) || t.isContentEditable) return;
      e.preventDefault();
      const s = useView.getState();
      if (!s.playing && s.hour >= maxHour) s.setHour(0);
      s.setPlaying(!s.playing);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxHour]);

  const pct = (h: number) => `${(Math.max(0, Math.min(maxHour, h)) / maxHour) * 100}%`;

  return (
    <section className="dock" aria-label="Forecast timeline">
      <div className="dock__row">
        <button
          type="button"
          className="play-btn"
          aria-label={playing ? "Pause forecast" : "Play forecast"}
          onClick={() => {
            if (!playing && hour >= maxHour) setHour(0);
            setPlaying(!playing);
          }}
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <div className="dock__time" aria-live="off">
          <span className="dock__clock">{dayClock(current)}</span>
          <span className="dock__rel">
            {sinceDeparture < -0.01
              ? `${duration(-sinceDeparture * 3600)} before departure`
              : sinceDeparture < 0.01
                ? "Departure"
                : `+${duration(sinceDeparture * 3600)} after departure`}
          </span>
        </div>
        <div className="dock__controls">
          <SegmentedControl<HeatMetric>
            size="sm"
            label="Heatmap layer"
            value={metric}
            onChange={(m) => {
              setMetric(m);
              setShowHeatmap(true);
            }}
            options={[
              { value: "risk", label: "Risk" },
              { value: "wind", label: "Wind" },
              { value: "rain", label: "Rain" },
              { value: "snow", label: "Snow" },
            ]}
          />
          <button
            type="button"
            className={`icon-btn${showHeatmap ? " is-on" : ""}`}
            aria-pressed={showHeatmap}
            aria-label={showHeatmap ? "Hide weather heatmap" : "Show weather heatmap"}
            title={showHeatmap ? "Hide heatmap" : "Show heatmap"}
            onClick={() => setShowHeatmap(!showHeatmap)}
          >
            <Icon name="layers" size={16} />
          </button>
        </div>
      </div>

      <div className="timeline">
        <div className="timeline__trip" style={{ left: pct(departOffset), width: `calc(${pct(arriveOffset)} - ${pct(departOffset)})` }} title={`Route ${route.id} on the road`} />
        <input
          className="timeline__range"
          type="range"
          min={0}
          max={maxHour}
          step={0.01}
          value={hour}
          aria-label="Forecast hour"
          aria-valuetext={`${dayClock(current)}, ${Math.round(hour)} hours from departure hour`}
          style={{ ["--pct" as string]: pct(hour) }}
          onPointerDown={() => setPlaying(false)}
          onChange={(e) => setHour(Number(e.target.value))}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 6 : 1;
            let next: number | null = null;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.floor(hour) + step;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.ceil(hour) - step;
            if (e.key === "Home") next = 0;
            if (e.key === "End") next = maxHour;
            if (next !== null) {
              e.preventDefault();
              setPlaying(false);
              setHour(Math.max(0, Math.min(maxHour, next)));
            }
          }}
        />
        <div className="timeline__ticks" aria-hidden>
          {ticks.map((t) => (
            <span key={t.h} className={`timeline__tick${t.major ? " is-major" : ""}`} style={{ left: pct(t.h) }}>
              <span>{t.label}</span>
            </span>
          ))}
        </div>
      </div>
      <Legend metric={metric} />
    </section>
  );
}

function Legend({ metric }: { metric: HeatMetric }) {
  if (metric === "risk") {
    return (
      <div className="legend" aria-label="Risk legend">
        {RISK_KEYS.map((k) => (
          <span key={k} className="legend__item">
            <span className="risk-dot" style={{ background: riskCss(k) }} />
            {RISK_LABEL[k]}
          </span>
        ))}
      </div>
    );
  }
  const ramp = RAMPS[metric];
  const max = ramp[ramp.length - 1][0];
  const stops = ramp
    .map(([v, c]) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.max(0.15, c[3] / 255)}) ${(v / max) * 100}%`)
    .join(", ");
  const unit = metric === "wind" ? "mph" : "in/hr";
  const marks = ramp.slice(-4).map(([v]) => v);
  return (
    <div className="legend legend--ramp" aria-label={`${metric} legend`}>
      <div className="legend__ramp" style={{ background: `linear-gradient(90deg, ${stops})` }}>
        {marks.map((v) => (
          <span key={v} className="legend__mark" style={{ left: `${(v / max) * 100}%` }}>
            {v}
          </span>
        ))}
      </div>
      <span className="legend__unit">
        {unit} · colours match risk thresholds
      </span>
    </div>
  );
}
