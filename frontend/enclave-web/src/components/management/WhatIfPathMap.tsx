"use client";
import { useEffect, useRef, useState } from "react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addFixedFacilityLayer } from '@/lib/fixedFacilityLayer';
import { addServiceAreaBoundary, PILOT_SERVICE_BOUNDS } from '@/lib/serviceAreaBoundary';
import type { FacilityIssue } from "@/lib/api";

type Point = { latitude: number; longitude: number };
export type PickTarget = "origin" | "destination";
type Props = {
  origin: Point | null;
  destination: Point | null;
  target: PickTarget;
  issues: FacilityIssue[];
  onTargetChange?: (target: PickTarget) => void;
  onPick: (target: PickTarget, point: Point) => void;
};
// Matches backend/navigation/config.py PILOT_BBOX; a development window, not a legal boundary.
const [west, south, east, north] = PILOT_SERVICE_BOUNDS;
export function isPilotPoint(point: Point) {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= south &&
    point.latitude <= north &&
    point.longitude >= west &&
    point.longitude <= east
  );
}
export function parseMapPoint(lat: string, lng: string): Point | null {
  if (!lat.trim() || !lng.trim()) return null;
  const point = { latitude: Number(lat), longitude: Number(lng) };
  return isPilotPoint(point) ? point : null;
}
export function pathDistance(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function WhatIfPathMap({
  origin,
  destination,
  target,
  issues,
  onPick,
  onTargetChange,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const sync = () => {
      setExpanded(document.fullscreenElement === panel.current);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === panel.current)
        await document.exitFullscreen();
      else if (panel.current?.requestFullscreen)
        await panel.current.requestFullscreen();
      else
        setFullscreenError(
          "Fullscreen is not supported here. Use the larger map below.",
        );
    } catch {
      setFullscreenError(
        "Unable to open fullscreen. The larger map below is still available.",
      );
    }
  }
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const api = useRef<typeof MapLibre | null>(null);
  const latest = useRef({ target, onPick });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    latest.current = { target, onPick };
  }, [target, onPick]);
  useEffect(() => {
    let disposed = false;
    let instance: MapLibre.Map | undefined;
    let observer: ResizeObserver | undefined;
    import("maplibre-gl")
      .then((M) => {
        if (disposed || !host.current) return;
        api.current = M;
        M.setWorkerUrl('/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs');
        instance = new M.Map({
          container: host.current,
          center: [101.7308667, 3.2253785],
          zoom: 16,
          minZoom: 12,
          maxZoom: 19,
          style: {
            version: 8,
            glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
            sources: {
              osm: {
                type: "raster",
                tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 19,
                attribution:
                  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
        });
        map.current = instance;
        instance.scrollZoom.disable();
        instance.addControl(
          new M.NavigationControl({ showCompass: false }),
          "top-right",
        );
        instance.on("click", (event) => {
          if (instance?.getLayer("candidate-facilities-circle") && instance.queryRenderedFeatures(event.point, { layers: ["candidate-facilities-circle"] }).length) return;
          const point = {
            latitude: event.lngLat.lat,
            longitude: event.lngLat.lng,
          };
          if (isPilotPoint(point))
            latest.current.onPick(latest.current.target, point);
        });
        instance.on("error", () => {
          if (!disposed) setTileError(true);
        });
        instance.on("load", () => {
          if (disposed || !instance) return;
          addServiceAreaBoundary(instance);
          instance.addSource("endpoint-connector", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          instance.addLayer({
            id: "endpoint-connector",
            type: "line",
            source: "endpoint-connector",
            paint: {
              "line-color": "#202c46",
              "line-width": 3,
              "line-dasharray": [2, 2],
            },
          });
          setReady(true);
        });
        observer = new ResizeObserver(() => instance?.resize());
        observer.observe(host.current);
      })
      .catch(() => {
        if (!disposed)
          setError(
            "Unable to load MapLibre. Check WebGL support or use the coordinate fields below.",
          );
        instance?.remove();
        map.current = null;
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const M = api.current;
    const instance = map.current;
    if (!M || !instance || !ready) return;
    const markers: MapLibre.Marker[] = [];
    const seen = new Set<string>();
    const issuePins = issues.filter(issue => {
      if (seen.has(issue.facility_id) || !isPilotPoint(issue)) return false;
      seen.add(issue.facility_id); return true;
    }).map(issue => ({ id: issue.facility_id, coordinate: [issue.longitude, issue.latitude] as [number, number],
      label: '!', description: `${issue.facility_name} - ${issue.facility_type}`, color: '#d42b35' }));
    const facilityLayer = addFixedFacilityLayer(instance, M, 'candidate-facilities', issuePins);
    const pin = (
      point: Point | null,
      label: string,
      color: string,
      kind: PickTarget,
    ) => {
      if (!point) return;
      const el = document.createElement("div");
      el.textContent = label;
      el.title = kind === "origin" ? "Starting point A" : "Destination B";
      Object.assign(el.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "30px",
        height: "30px",
        border: "3px solid white",
        borderRadius: "50%",
        background: color,
        color: "white",
        fontWeight: "700",
        boxShadow: "0 1px 5px #0004",
        cursor: "grab",
      });
      el.addEventListener("click", (event) => event.stopPropagation());
      const marker = new M.Marker({ element: el, draggable: true })
        .setLngLat([point.longitude, point.latitude])
        .addTo(instance);
      marker.on("dragend", () => {
        const value = marker.getLngLat();
        const next = { latitude: value.lat, longitude: value.lng };
        if (isPilotPoint(next)) latest.current.onPick(kind, next);
        else marker.setLngLat([point.longitude, point.latitude]);
      });
      markers.push(marker);
    };
    pin(origin, "A", "#202c46", "origin");
    pin(destination, "B", "#966114", "destination");
    const source = instance.getSource("endpoint-connector") as
      MapLibre.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features:
        origin && destination
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [origin.longitude, origin.latitude],
                    [destination.longitude, destination.latitude],
                  ],
                },
              },
            ]
          : [],
    });
    return () => {
      markers.forEach((marker) => marker.remove());
      if (map.current === instance) facilityLayer.remove();
    };
  }, [origin, destination, issues, ready]);
  return (
    <div
      ref={panel}
      className={
        expanded
          ? "flex h-dvh w-screen min-w-0 flex-col gap-3 overflow-auto bg-background p-4 sm:p-6"
          : "flex min-w-0 flex-col gap-3"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-primary">
            Choose journey points
          </h3>
          <p className="text-xs text-muted-foreground">
            Click to set{" "}
            {target === "origin" ? "A · Starting point" : "B · Destination"}
            {expanded ? " · Press Esc to exit fullscreen" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {expanded &&
            onTargetChange &&
            (["origin", "destination"] as const).map((point) => (
              <button
                key={point}
                type="button"
                aria-pressed={target === point}
                onClick={() => onTargetChange(point)}
                className={`min-h-11 rounded-xl border border-border px-3 text-xs font-semibold ${target === point ? "bg-brand text-primary-foreground" : "bg-white text-primary"}`}
              >
                {point === "origin" ? "A · Starting point" : "B · Destination"}
              </button>
            ))}
          <button
            type="button"
            disabled={!ready}
            onClick={() => void toggleFullscreen()}
            aria-label={
              expanded ? "Exit map fullscreen" : "Open map fullscreen"
            }
            className="min-h-11 rounded-xl bg-brand px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {expanded ? "Exit fullscreen" : "Expand map ⤢"}
          </button>
        </div>
      </div>
      {fullscreenError && (
        <p role="status" className="text-xs text-status-orange">
          {fullscreenError}
        </p>
      )}
      <div
        ref={host}
        role="region"
        aria-label={`Journey map. Click to set ${target === "origin" ? "starting point A" : "destination B"}. Coordinate fields are available below.`}
        className={`relative isolate z-0 w-full overflow-hidden rounded-2xl border border-border bg-muted ${expanded ? "min-h-[260px] flex-1" : "h-[420px] sm:h-[520px]"}`}
      />
      {!ready && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading map…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {tileError && (
        <p role="status" className="text-xs text-status-orange">
          Some map resources could not load. Check your connection and WebGL
          support; coordinate entry is still available.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          A: Starting point · B: Destination · Red dots: Candidate facilities · Dashed outline: Service area
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            map.current?.fitBounds([[west, south], [east, north]], { padding: 24, duration: 400 })
          }
          className="min-h-10 px-2 font-semibold text-primary underline disabled:opacity-50"
        >
          Show service area
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The short dashed connector joins your selected endpoints. It is not a
        calculated walking route. The backend evaluates the journey when you
        compare plans.
      </p>
    </div>
  );
}
