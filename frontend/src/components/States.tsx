import { useEffect, useState } from "react";
import { EXAMPLES, type ExampleTrip } from "../lib/examples";
import { Icon, Spinner } from "./ui";

const STAGES = [
  { after: 0, text: "Finding three truck routes" },
  { after: 1800, text: "Sampling forecasts at each checkpoint ETA" },
  { after: 4500, text: "Scoring risk and building the heatmap" },
  { after: 9000, text: "Still working — the free weather service is pacing requests" },
];

export function LoadingState() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - t0), 250);
    return () => window.clearInterval(id);
  }, []);
  const stage = [...STAGES].reverse().find((s) => elapsed >= s.after)!;
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__line">
        <Spinner /> <span>{stage.text}…</span>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 120}ms` }}>
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--bar" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="banner banner--error" role="alert">
      <Icon name="alert" size={16} />
      <div>
        <p>{message}</p>
        <button type="button" className="link-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ onPick }: { onPick: (t: ExampleTrip) => void }) {
  return (
    <div className="empty">
      <h2 className="empty__title">Try a corridor</h2>
      <p className="empty__text">
        Compares three routes using hour-by-hour forecasts at each checkpoint, then recommends the safest one.
      </p>
      <div className="examples">
        {EXAMPLES.map((t) => (
          <button key={t.title} type="button" className="example" onClick={() => onPick(t)}>
            <span className="example__title">{t.title}</span>
            <span className="example__note">
              {t.note} · {(t.load_lb / 1000).toFixed(0)}k lb
            </span>
            <Icon name="chevron" size={16} className="example__chev" />
          </button>
        ))}
      </div>
    </div>
  );
}
