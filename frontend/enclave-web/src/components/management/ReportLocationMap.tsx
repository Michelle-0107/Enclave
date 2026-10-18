"use client";

import { useEffect, useRef, useState } from "react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = { latitude: number; longitude: number };

export default function ReportLocationMap({ latitude, longitude }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let map: MapLibre.Map | undefined;
    let observer: ResizeObserver | undefined;

    import("maplibre-gl").then((MapLibreApi) => {
      if (disposed || !host.current) return;
      MapLibreApi.setWorkerUrl("/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs");
      map = new MapLibreApi.Map({
        container: host.current,
        center: [longitude, latitude],
        zoom: 16,
        style: "https://tiles.openfreemap.org/styles/liberty",
      });
      const pin = document.createElement("div");
      pin.setAttribute("aria-label", "Report location marker");
      Object.assign(pin.style, {
        width: "22px",
        height: "22px",
        border: "3px solid white",
        borderRadius: "50%",
        background: "#202c46",
        boxShadow: "0 1px 5px #0006",
      });
      map.addControl(new MapLibreApi.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (disposed || !map) return;
        new MapLibreApi.Marker({ element: pin }).setLngLat([longitude, latitude]).addTo(map);
        setReady(true);
      });
      map.on("error", () => { if (!disposed) setError(true); });
      observer = new ResizeObserver(() => map?.resize());
      observer.observe(host.current);
    }).catch(() => { if (!disposed) setError(true); });

    return () => {
      disposed = true;
      observer?.disconnect();
      map?.remove();
    };
  }, [latitude, longitude]);

  const navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

  return (
    <section aria-label="Report location map" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-h-[260px] flex-1 overflow-hidden rounded-2xl bg-enclave-lavender">
        <div ref={host} className="absolute inset-0 h-full w-full" />
        {!ready && !error && <p role="status" className="absolute inset-0 flex items-center justify-center bg-enclave-lavender text-sm text-muted-foreground">Loading location map…</p>}
        {error && <p role="status" className="absolute inset-0 flex items-center justify-center bg-enclave-lavender p-4 text-center text-sm text-muted-foreground">Map preview could not load. Use the navigation link to view this location.</p>}
      </div>
      <p className="text-sm text-muted-foreground">{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
      <a href={navigationUrl} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center justify-center rounded-2xl bg-enclave-lavender px-5 text-sm font-semibold text-primary hover:opacity-80">
        Open navigation map
      </a>
    </section>
  );
}
