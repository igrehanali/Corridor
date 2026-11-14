import { motion } from "framer-motion";
import { dayClock, lb } from "../lib/format";
import type { Interval, PlanInput } from "../lib/types";
import { SegmentedControl, spring } from "./ui";

/** Compact read-only trip once a plan exists, so results get the space. */
export function TripSummary({
  input,
  onEdit,
  onChange,
}: {
  input: PlanInput;
  onEdit: () => void;
  onChange: (next: PlanInput) => void;
}) {
  const short = (label: string) => label.split(", ").slice(0, 2).join(", ");
  return (
    <motion.section
      className="trip-summary"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      aria-label="Current trip"
    >
      <div className="trip-summary__route">
        <div className="trip-summary__places">
          <span className="trip-summary__place">
            <span className="dot dot--origin" /> {short(input.origin.label)}
          </span>
          <span className="trip-summary__place">
            <span className="dot dot--dest" /> {short(input.destination.label)}
          </span>
        </div>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit
        </button>
      </div>
      <p className="trip-summary__meta">
        Departs {dayClock(input.departure)} · {lb(input.load_lb)} · HOS {input.hos ? "on" : "off"}
      </p>
      <div className="trip-summary__interval">
        <span className="field__label">Checkpoint every</span>
        <SegmentedControl<Interval>
          size="sm"
          label="Checkpoint interval"
          value={input.interval_mi}
          onChange={(v) => onChange({ ...input, interval_mi: v })}
          options={[
            { value: 10, label: "10 mi" },
            { value: 25, label: "25 mi" },
            { value: 50, label: "50 mi" },
          ]}
        />
      </div>
    </motion.section>
  );
}
