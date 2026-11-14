import { COORDINATE_SYSTEM, type Layer, type PickingInfo } from "@deck.gl/core";
import { BitmapLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { AttributionControl, NavigationControl, useControl, type MapRef } from "react-map-gl/maplibre";

import { boundsOf, pointAtMile, riskSegments, truckAt, type RiskSegment } from "../lib/geo";
import { buildRaster, cellLookup, metricValues } from "../lib/heatmap";
import { RISK_RGB } from "../lib/risk";
import { useView } from "../lib/store";
import type { Checkpoint, PlanResult, RestStop, RouteResult } from "../lib/types";
import { MapTooltip, type HoverInfo } from "./MapTooltip";

const MAP_STYLE =
  (import.meta.env.VITE_MAP_STYLE as string | undefined) ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const INITIAL_VIEW = { longitude: -98.5, latitude: 39.5, zoom: 3.6 };
const MUTED: [number, number, number] = [124, 136, 156];
const INK: [number, number, number] = [17, 24, 39];

function DeckOverlay(props: MapboxOverlayProps) {
  // MapboxOverlay implements MapLibre's IControl; the cast bridges the
  // mapbox/maplibre type names that react-map-gl uses.
  const overlay = useControl(() => new MapboxOverlay({ ...props, interleaved: true }) as never) as MapboxOverlay;
  overlay.setProps(props);
  return null;
}

export interface MapPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface Props {
  plan: PlanResult | undefined;
  padding: MapPadding;
  /** Changes when the surrounding layout changes enough to warrant a refit. */
  layoutKey: string;
}

interface RouteGeo {
  route: RouteResult;
  segments: RiskSegment[];
  midpoint: [number, number];
}

function MapViewInner({ plan, padding, layoutKey }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>();
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const selectedId = useView((s) => s.selectedRouteId);
  const hour = useView((s) => s.hour);
  const metric = useView((s) => s.metric);
  const showHeatmap = useView((s) => s.showHeatmap);
  const showCheckpoints = useView((s) => s.showCheckpoints);
  const scrub = useView((s) => s.scrub);
  const focus = useView((s) => s.focus);
  const setSelected = useView((s) => s.setSelected);
  const setFocus = useView((s) => s.setFocus);

  // Static per-plan geometry: computed once per result, not per frame.
  const geo = useMemo<RouteGeo[]>(
    () =>
      (plan?.routes ?? []).map((route) => ({
        route,
        segments: riskSegments(route),
        midpoint: pointAtMile(route, route.summary.distance_mi * 0.5),
      })),
    [plan],
  );
  const heatValues = useMemo(() => (plan ? metricValues(plan.heatmap, metric) : null), [plan, metric]);
  const lookupCell = useMemo(() => (plan ? cellLookup(plan.heatmap) : null), [plan]);

  // Fit the camera to the routes when a plan arrives or the layout changes
  // (desktop panel ↔ mobile sheet), but not on every padding tweak.
  const paddingRef = useRef(padding);
  paddingRef.current = padding;
  const fit = useCallback(
    (duration = 900) => {
      if (!plan || !mapRef.current) return;
      const [[w, s], [e, n]] = boundsOf(plan.routes);
      mapRef.current.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: paddingRef.current, duration, essential: true },
      );
    },
    [plan],
  );
  useEffect(() => fit(), [fit, layoutKey]);

  // Departure hour + slider offset → seconds since the actual departure time.
  const elapsedS = useMemo(() => {
    if (!plan) return 0;
    const t0 = Date.parse(plan.heatmap.start) + hour * 3600_000;
    return (t0 - Date.parse(plan.request.departure)) / 1000;
  }, [plan, hour]);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Draw weather beneath place labels so city names stay readable.
    const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol");
    setLabelLayerId(firstSymbol?.id);
  }, []);

  const layers = useMemo(() => {
    if (!plan) return [];
    const selected = geo.find((g) => g.route.id === selectedId) ?? geo[0];
    const others = geo.filter((g) => g !== selected);
    const out: Layer[] = [];

    if (showHeatmap && heatValues) {
      const raster = buildRaster(plan.heatmap, heatValues, metric, hour);
      out.push(
        new BitmapLayer({
          id: "heatmap",
          image: { data: raster.data, width: raster.width, height: raster.height } as unknown as ImageData,
          bounds: plan.heatmap.bounds,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: "linear", magFilter: "linear" },
          opacity: 0.85,
          beforeId: labelLayerId,
          parameters: { depthWriteEnabled: false },
        } as never),
      );
    }

    out.push(
      new PathLayer<RouteGeo>({
        id: "routes-other-casing",
        data: others,
        getPath: (g: RouteGeo) => g.route.geometry,
        getColor: [255, 255, 255, 230],
        getWidth: 7,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onClick: ({ object }: PickingInfo<RouteGeo>) => object && setSelected(object.route.id),
        beforeId: labelLayerId,
      } as never),
      new PathLayer<RouteGeo>({
        id: "routes-other",
        data: others,
        getPath: (g: RouteGeo) => g.route.geometry,
        getColor: [...MUTED, 220],
        getWidth: 4,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [60, 72, 92, 255],
        onClick: ({ object }: PickingInfo<RouteGeo>) => object && setSelected(object.route.id),
        beforeId: labelLayerId,
      } as never),
    );

    if (selected) {
      out.push(
        new PathLayer<RouteGeo>({
          id: "route-selected-casing",
          data: [selected],
          getPath: (g: RouteGeo) => g.route.geometry,
          getColor: [255, 255, 255, 255],
          getWidth: 11,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
        }),
        new PathLayer<RiskSegment>({
          id: "route-selected",
          data: selected.segments,
          getPath: (s) => s.path,
          getColor: (s) => [...RISK_RGB[s.risk], 255],
          getWidth: 6,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
        }),
      );
      if (showCheckpoints) {
        out.push(
          new ScatterplotLayer<Checkpoint>({
            id: "checkpoints",
            data: selected.route.checkpoints,
            getPosition: (c) => [c.lon, c.lat],
            getFillColor: (c) => [...RISK_RGB[c.risk], 255],
            getLineColor: [255, 255, 255, 255],
            getRadius: (c) => (focus?.routeId === selected.route.id && focus.index === c.i ? 9 : 5),
            radiusUnits: "pixels",
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            stroked: true,
            pickable: true,
            onClick: ({ object }) => object && setFocus({ routeId: selected.route.id, index: object.i }),
            updateTriggers: { getRadius: [focus?.routeId, focus?.index] },
          }),
        );
      }
      out.push(
        new ScatterplotLayer<RestStop>({
          id: "rest-stops",
          data: selected.route.rest_stops,
          getPosition: (r) => [r.lon, r.lat],
          getFillColor: [...INK, 255],
          getLineColor: [255, 255, 255, 255],
          getRadius: (r) => (r.kind === "off_duty" ? 6 : 4.5),
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          stroked: true,
          pickable: true,
        }),
      );
    }

    const req = plan.request;
    out.push(
      new ScatterplotLayer<{ p: [number, number]; kind: string }>({
        id: "endpoints",
        data: [
          { p: [req.origin.lon, req.origin.lat], kind: "origin" },
          { p: [req.destination.lon, req.destination.lat], kind: "destination" },
        ],
        getPosition: (d) => d.p,
        getFillColor: (d) => (d.kind === "origin" ? [255, 255, 255, 255] : [...INK, 255]),
        getLineColor: (d) => (d.kind === "origin" ? [...INK, 255] : [255, 255, 255, 255]),
        getRadius: 7,
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        getLineWidth: 3,
        stroked: true,
      }),
    );

    // Route letters on the unselected routes so they can be told apart.
    out.push(
      new TextLayer<RouteGeo>({
        id: "route-badges",
        data: others,
        getPosition: (g: RouteGeo) => g.midpoint,
        getText: (g: RouteGeo) => g.route.id,
        getSize: 13,
        getColor: [255, 255, 255, 255],
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 700,
        background: true,
        getBackgroundColor: [...MUTED, 255],
        backgroundPadding: [6, 3, 6, 3],
        pickable: true,
        onClick: ({ object }: PickingInfo<RouteGeo>) => object && setSelected(object.route.id),
      } as never),
    );

    // Where each truck is at the slider time.
    const trucks = geo.map((g) => ({ g, state: truckAt(g.route, elapsedS) }));
    out.push(
      new ScatterplotLayer<(typeof trucks)[number]>({
        id: "trucks",
        data: trucks,
        getPosition: (t) => t.state.position,
        getFillColor: (t) => (t.g === selected ? [...INK, 255] : [...MUTED, 255]),
        getLineColor: (t) => (t.state.status === "resting" ? [247, 129, 31, 255] : [255, 255, 255, 255]),
        getRadius: (t) => (t.g === selected ? 11 : 8),
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        getLineWidth: 3,
        stroked: true,
        pickable: true,
        updateTriggers: { getPosition: elapsedS, getLineColor: elapsedS, getFillColor: selectedId },
      }),
      new TextLayer<(typeof trucks)[number]>({
        id: "truck-labels",
        data: trucks,
        getPosition: (t) => t.state.position,
        getText: (t) => t.g.route.id,
        getSize: (t) => (t.g === selected ? 12 : 10),
        getColor: [255, 255, 255, 255],
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 700,
        updateTriggers: { getPosition: elapsedS, getSize: selectedId },
      }),
    );

    if (scrub) {
      const g = geo.find((x) => x.route.id === scrub.routeId);
      if (g) {
        out.push(
          new ScatterplotLayer({
            id: "scrub",
            data: [pointAtMile(g.route, scrub.mile)],
            getPosition: (p: [number, number]) => p,
            getFillColor: [255, 255, 255, 255],
            getLineColor: [...INK, 255],
            getRadius: 8,
            radiusUnits: "pixels",
            lineWidthUnits: "pixels",
            getLineWidth: 3,
            stroked: true,
          }),
        );
      }
    }
    return out;
  }, [
    plan,
    geo,
    selectedId,
    showHeatmap,
    showCheckpoints,
    heatValues,
    metric,
    hour,
    labelLayerId,
    elapsedS,
    scrub,
    focus,
    setSelected,
    setFocus,
  ]);

  const onHover = useCallback(
    (info: PickingInfo) => {
      if (!plan) return setHover(null);
      const { x, y, object, layer, coordinate } = info;
      if (object && layer) {
        const id = layer.id;
        if (id === "checkpoints") return setHover({ x, y, kind: "checkpoint", checkpoint: object as Checkpoint });
        if (id === "rest-stops") return setHover({ x, y, kind: "rest", rest: object as RestStop });
        if (id === "trucks")
          return setHover({ x, y, kind: "truck", route: object.g.route, state: object.state, elapsedS });
        if (id.startsWith("routes-other") || id === "route-badges")
          return setHover({ x, y, kind: "route", route: (object as RouteGeo).route });
      }
      if (coordinate && lookupCell && useView.getState().showHeatmap) {
        const cell = lookupCell(coordinate[0], coordinate[1]);
        if (cell >= 0) return setHover({ x, y, kind: "cell", cell, heatmap: plan.heatmap, load: plan.request.load_lb });
      }
      setHover(null);
    },
    [plan, lookupCell, elapsedS],
  );

  return (
    <div className="map-root">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={MAP_STYLE}
        onLoad={onLoad}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        attributionControl={false}
        reuseMaps
      >
        <NavigationControl position="top-right" showCompass={false} />
        <AttributionControl compact position="bottom-right" />
        <DeckOverlay
          layers={layers}
          onHover={onHover}
          getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        />
      </Map>
      {plan && (
        <button type="button" className="map-fit" onClick={() => fit(600)} aria-label="Fit all routes" title="Fit all routes">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      )}
      {hover && <MapTooltip info={hover} hour={hour} />}
    </div>
  );
}

export const MapView = memo(MapViewInner);
