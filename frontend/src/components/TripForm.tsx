import { useEffect, useMemo, useState } from "react";
import { nextQuarterHour, toLocalInput } from "../lib/format";
import type { Interval, Place, PlanInput } from "../lib/types";
import { PlaceInput } from "./PlaceInput";
import { Icon, SegmentedControl, Spinner, Toggle } from "./ui";

interface Props {
  initial: PlanInput | null;
  loading: boolean;
  hasResult: boolean;
  onSubmit: (input: PlanInput) => void;
}

const MAX_LOAD = 80_000;
const DAY_MS = 86_400_000;

function departurePresets(now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(6, 0, 0, 0);
  return [
    { label: "Now", value: nextQuarterHour(now, 0) },
    { label: "In 3 h", value: nextQuarterHour(now, 180) },
    { label: "Tomorrow 6 AM", value: tomorrow },
  ];
}

function loadHint(load: number): string {
  if (load > 40_000) return "Over 40,000 lb: 35–44 mph wind counts as Severe, 45+ mph is No Travel.";
  if (load > 30_000) return "Over 30,000 lb: 45–54 mph wind is No Travel.";
  return "Standard wind thresholds apply at this weight.";
}

export function TripForm({ initial, loading, hasResult, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(initial?.origin ?? null);
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null);
  const [departure, setDeparture] = useState(() =>
    toLocalInput(initial ? new Date(initial.departure) : nextQuarterHour()),
  );
  const [load, setLoad] = useState(String(initial?.load_lb ?? 40_000));
  const [interval, setIntervalMi] = useState<Interval>(initial?.interval_mi ?? 25);
  const [hos, setHos] = useState(initial?.hos ?? true);
  const [touched, setTouched] = useState(false);

  // Example trips and URL restores replace the whole form.
  useEffect(() => {
    if (!initial) return;
    setOrigin(initial.origin);
    setDestination(initial.destination);
    setDeparture(toLocalInput(new Date(initial.departure)));
    setLoad(String(initial.load_lb));
    setIntervalMi(initial.interval_mi);
    setHos(initial.hos);
  }, [initial]);

  const now = new Date();
  const loadNum = Number(load);
  const depDate = useMemo(() => new Date(departure), [departure]);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!origin) e.origin = "Choose a starting point from the list";
    if (!destination) e.destination = "Choose a destination from the list";
    if (origin && destination && origin.lat === destination.lat && origin.lon === destination.lon)
      e.destination = "Destination must differ from origin";
    if (!load.trim() || !Number.isFinite(loadNum) || loadNum < 0) e.load = "Enter the cargo weight in pounds";
    else if (loadNum > MAX_LOAD) e.load = "Must be at most 80,000 lb";
    if (Number.isNaN(depDate.getTime())) e.departure = "Pick a departure time";
    else if (depDate.getTime() < Date.now() - 3600_000) e.departure = "Departure can't be in the past";
    else if (depDate.getTime() > Date.now() + 10 * DAY_MS) e.departure = "Forecasts only reach 10 days ahead";
    return e;
  }, [origin, destination, load, loadNum, depDate]);
  const valid = Object.keys(errors).length === 0;

  const build = (overrides: Partial<PlanInput> = {}): PlanInput => ({
    origin: origin!,
    destination: destination!,
    departure: depDate.toISOString(),
    load_lb: loadNum,
    interval_mi: interval,
    hos,
    ...overrides,
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (valid) onSubmit(build());
  };

  // With a plan on screen, sampling and HOS changes re-plan immediately:
  // routes are cached server-side, so this only re-samples weather.
  const changeAndReplan = (overrides: Partial<PlanInput>) => {
    if (hasResult && valid) onSubmit(build(overrides));
  };

  const show = (k: string) => (touched ? errors[k] : undefined);

  return (
    <form className="trip-form" onSubmit={submit} noValidate>
      <div className="trip-form__places">
        <PlaceInput
          label="From"
          placeholder="City, address or depot"
          value={origin}
          onChange={setOrigin}
          icon={<span className="dot dot--origin" />}
          error={show("origin")}
        />
        <button
          type="button"
          className="icon-btn swap-btn"
          aria-label="Swap origin and destination"
          title="Swap"
          onClick={() => {
            setOrigin(destination);
            setDestination(origin);
          }}
        >
          <Icon name="swap" size={16} />
        </button>
        <PlaceInput
          label="To"
          placeholder="City, address or depot"
          value={destination}
          onChange={setDestination}
          icon={<span className="dot dot--dest" />}
          error={show("destination")}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="departure">
          Departure
        </label>
        <input
          id="departure"
          className="input"
          type="datetime-local"
          value={departure}
          min={toLocalInput(new Date(Date.now() - 3600_000))}
          max={toLocalInput(new Date(Date.now() + 10 * DAY_MS))}
          onChange={(e) => setDeparture(e.target.value)}
          aria-invalid={!!show("departure")}
        />
        <div className="chips">
          {departurePresets(now).map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setDeparture(toLocalInput(p.value))}>
              {p.label}
            </button>
          ))}
        </div>
        {show("departure") && <p className="field__error">{show("departure")}</p>}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="load">
          Load weight
        </label>
        <div className="input-suffix">
          <input
            id="load"
            className="input"
            inputMode="numeric"
            value={load}
            onChange={(e) => setLoad(e.target.value.replace(/[^\d]/g, ""))}
            aria-invalid={!!show("load")}
            aria-describedby="load-hint"
          />
          <span className="input-suffix__unit">lb</span>
        </div>
        {show("load") ? (
          <p className="field__error">{show("load")}</p>
        ) : (
          <p className="field__hint" id="load-hint">
            {Number.isFinite(loadNum) ? loadHint(loadNum) : ""}
          </p>
        )}
      </div>

      <div className="field">
        <span className="field__label">Weather checkpoint every</span>
        <SegmentedControl<Interval>
          label="Checkpoint interval"
          value={interval}
          onChange={(v) => {
            setIntervalMi(v);
            changeAndReplan({ interval_mi: v });
          }}
          options={[
            { value: 10, label: "10 mi" },
            { value: 25, label: "25 mi" },
            { value: 50, label: "50 mi" },
          ]}
        />
      </div>

      <Toggle
        checked={hos}
        onChange={(v) => {
          setHos(v);
          changeAndReplan({ hos: v });
        }}
        label="Hours-of-service rest"
        description="30 min after 8 h driving, 10 h off after 11 h"
      />

      <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
        {loading ? (
          <>
            <Spinner /> Planning…
          </>
        ) : hasResult ? (
          "Update plan"
        ) : (
          "Plan routes"
        )}
      </button>
    </form>
  );
}
