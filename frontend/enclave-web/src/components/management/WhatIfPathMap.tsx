"use client";
import { useEffect, useRef, useState } from "react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FacilityIssue } from "@/lib/api";

type Point = { latitude: number; longitude: number };
export type PickTarget = "origin" | "destination";
type Props = {
  origin: Point | null;
  destination: Point | null;
  target: PickTarget;
  issues: FacilityIssue[];
  onPick: (target: PickTarget, point: Point) => void;
};
// Matches backend/navigation/config.py PILOT_BBOX; a development window, not a legal boundary.
const south = 3.217,
  west = 101.721,
  north = 3.235,
  east = 101.741;
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
}: Props) {
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
        instance = new M.Map({
          container: host.current,
          center: [101.7308667, 3.2253785],
          zoom: 16,
          minZoom: 14,
          maxZoom: 19,
          maxBounds: [
            [west, south],
            [east, north],
          ],
          style: {
            version: 8,
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
    const popups: MapLibre.Popup[] = [];
    const seen = new Set<string>();
    issues.forEach((issue) => {
      if (seen.has(issue.facility_id) || !isPilotPoint(issue)) return;
      seen.add(issue.facility_id);
      const dot = document.createElement("button");
      dot.type = "button";
      dot.title = issue.facility_name;
      dot.setAttribute("aria-label", issue.facility_name);
      Object.assign(dot.style, {
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        border: "2px solid white",
        background: "#a63e37",
        cursor: "pointer",
      });
      dot.addEventListener("click", (event) => event.stopPropagation());
      const popup = new M.Popup({ offset: 12 }).setText(
        `${issue.facility_name} · ${issue.facility_type}`,
      );
      popups.push(popup);
      markers.push(
        new M.Marker({ element: dot })
          .setLngLat([issue.longitude, issue.latitude])
          .setPopup(popup)
          .addTo(instance),
      );
    });
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
      popups.forEach((popup) => popup.remove());
    };
  }, [origin, destination, issues, ready]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        ref={host}
        role="region"
        aria-label={`Journey map. Click to set ${target === "origin" ? "starting point A" : "destination B"}. Coordinate fields are available below.`}
        className="relative isolate z-0 h-[300px] w-full overflow-hidden rounded-2xl border border-border bg-muted sm:h-[360px]"
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
          A: Starting point · B: Destination · Red dots: Candidate facilities
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            map.current?.jumpTo({ center: [101.7308667, 3.2253785], zoom: 16 })
          }
          className="min-h-10 px-2 font-semibold text-primary underline disabled:opacity-50"
        >
          Reset view
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Dashed line connects your selected endpoints only. It is not a
        calculated walking route. The backend evaluates the journey when you
        compare plans.
      </p>
    </div>
  );
}
