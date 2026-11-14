import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ForecastDock } from "./components/ForecastDock";
import { MOBILE_QUERY, Panel, useMediaQuery } from "./components/Panel";
import { Results } from "./components/Results";
import { RulesSheet } from "./components/RulesSheet";
import { EmptyState, ErrorState, LoadingState } from "./components/States";
import { TripForm } from "./components/TripForm";
import { TripSummary } from "./components/TripSummary";
import { Icon } from "./components/ui";
import { api, ApiError } from "./lib/api";
import type { ExampleTrip } from "./lib/examples";
import { nextQuarterHour } from "./lib/format";
import { useView } from "./lib/store";
import type { PlanInput } from "./lib/types";
import { inputToSearch, searchToInput } from "./lib/url";
import { MapView, type MapPadding } from "./map/MapView";

/** Two inputs describe the same trip if only presentation settings differ. */
const sameTrip = (a: PlanInput | undefined, b: PlanInput | undefined) =>
  !!a &&
  !!b &&
  a.origin.lat === b.origin.lat &&
  a.origin.lon === b.origin.lon &&
  a.destination.lat === b.destination.lat &&
  a.destination.lon === b.destination.lon &&
  a.departure === b.departure &&
  a.load_lb === b.load_lb;

function initialInput(): PlanInput | null {
  const fromUrl = searchToInput(window.location.search);
  // A shared link whose departure is already in the past is re-timed to now.
  if (fromUrl && Date.parse(fromUrl.departure) < Date.now() - 3600_000)
    fromUrl.departure = nextQuarterHour(new Date(), 0).toISOString();
  return fromUrl;
}

export default function App() {
  const [input, setInput] = useState<PlanInput | null>(initialInput);
  const [formSeed, setFormSeed] = useState<PlanInput | null>(input);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(true);
  const mobile = useMediaQuery(MOBILE_QUERY);

  const query = useQuery({
    queryKey: ["plan", input],
    queryFn: ({ signal }) => api.plan(input!, signal),
    enabled: !!input,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: (count, err) => err instanceof ApiError && err.status === 0 && count < 1,
  });
  const plan = query.data;
  const stale = query.isFetching && query.isPlaceholderData;

  // New trip → select the recommended route and rewind the forecast slider.
  // Interval / HOS changes on the same trip keep the driver's selection.
  const lastTrip = useRef<PlanInput | undefined>();
  useEffect(() => {
    if (!plan) return;
    const req = plan.request as PlanInput;
    if (!sameTrip(lastTrip.current, req)) {
      useView.getState().reset(plan.recommendation.route_id);
      setEditing(false); // collapse the form so the results get the space
    }
    lastTrip.current = req;
  }, [plan]);

  const submit = useCallback((next: PlanInput) => {
    setInput(next);
    window.history.replaceState(null, "", inputToSearch(next));
  }, []);

  const pickExample = (t: ExampleTrip) => {
    const next: PlanInput = {
      origin: t.origin,
      destination: t.destination,
      departure: nextQuarterHour(new Date(), 60).toISOString(),
      load_lb: t.load_lb,
      interval_mi: 25,
      hos: true,
    };
    setFormSeed(next);
    submit(next);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the URL bar already holds the link */
    }
  };

  const padding = useMemo<MapPadding>(
    () =>
      mobile
        ? { top: 150, bottom: sheetHeight + 24, left: 24, right: 24 }
        : { top: 64, bottom: 200, left: 452, right: 72 },
    [mobile, sheetHeight],
  );

  const error = query.error as ApiError | null;
  const showLoading = query.isFetching && !plan;

  return (
    <div className="app">
      <MapView plan={plan} padding={padding} layoutKey={mobile ? "mobile" : "desktop"} />

      <Panel expanded={sheetExpanded} onExpandedChange={setSheetExpanded} onSheetHeight={setSheetHeight}>
        <header className="brand">
          <div className="brand__mark" aria-hidden>
            <Icon name="truck" size={18} />
          </div>
          <div className="brand__text">
            <h1>Corridor</h1>
            <p>Weather-aware truck routing</p>
          </div>
          <div className="brand__actions">
            {plan && (
              <button type="button" className="icon-btn" onClick={share} aria-label="Copy link to this plan" title="Copy link">
                <Icon name={copied ? "check" : "share"} size={16} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setRulesOpen(true)} aria-label="How risk is scored" title="How risk is scored">
              <Icon name="info" size={16} />
            </button>
          </div>
        </header>

        <div className="panel__scroll">
          {editing || !plan || !input ? (
            <TripForm initial={formSeed} loading={query.isFetching} hasResult={!!plan} onSubmit={submit} />
          ) : (
            <TripSummary
              input={input}
              onEdit={() => {
                setFormSeed(input);
                setEditing(true);
              }}
              onChange={submit}
            />
          )}
          {error && !query.isFetching && <ErrorState message={error.message} onRetry={() => query.refetch()} />}
          {showLoading && <LoadingState />}
          {plan && <Results plan={plan} stale={stale} />}
          {!input && !plan && <EmptyState onPick={pickExample} />}
        </div>
      </Panel>

      {plan && <ForecastDock plan={plan} />}
      {query.isFetching && plan && (
        <div className="map-status" role="status">
          Updating plan…
        </div>
      )}
      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
