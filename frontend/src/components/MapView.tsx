import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { circleRing } from "../engine/geo";
import { MG_ROAD } from "../engine/scenarios";
import type { Simulator } from "../engine/simulator";

// MapLibre finds its worker relative to its own module, which Vite's bundling moves; point at it explicitly.
maplibregl.setWorkerUrl(workerUrl);

// Free OpenStreetMap vector tiles, no API key or account needed.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const FONT = ["Noto Sans Regular"];

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, string | number>>;
const collection = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

export function MapView({ sim, version }: { sim: Simulator; version: number }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: [MG_ROAD.lon + 0.01, MG_ROAD.lat],
      zoom: 12.3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      for (const id of ["search", "lines", "drivers", "riders"]) {
        map.addSource(id, { type: "geojson", data: collection([]) });
      }
      map.addLayer({ id: "search-fill", type: "fill", source: "search", paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.08 } });
      map.addLayer({
        id: "search-line",
        type: "line",
        source: "search",
        paint: { "line-color": "#0ea5e9", "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "lines",
        type: "line",
        source: "lines",
        paint: {
          "line-color": ["match", ["get", "kind"], "offer", "#f59e0b", "#2563eb"],
          "line-width": 3,
          "line-dasharray": [1.5, 1.5],
        },
      });
      map.addLayer({
        id: "drivers",
        type: "circle",
        source: "drivers",
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "match",
            ["get", "state"],
            "free", "#10b981",
            "offered", "#f59e0b",
            "busy", "#2563eb",
            "#94a3b8",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "riders",
        type: "circle",
        source: "riders",
        paint: { "circle-radius": 10, "circle-color": "#c026d3", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
      });
      map.addLayer({
        id: "labels",
        type: "symbol",
        source: "drivers",
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" },
        paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "rider-labels",
        type: "symbol",
        source: "riders",
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-offset": [0, -1.5], "text-anchor": "bottom" },
        paint: { "text-color": "#86198f", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pendingBookings = new Set([...sim.db.bookings.values()].filter((b) => b.status === "PENDING").map((b) => b.id));

    const search: Feature[] = [...sim.searches.values()]
      .filter((s) => pendingBookings.has(s.bookingId))
      .map((s) => ({
        type: "Feature",
        properties: { radius: s.radiusKm },
        geometry: { type: "Polygon", coordinates: [circleRing(s, s.radiusKm)] },
      }));

    const lines: Feature[] = [];
    for (const d of sim.drivers.values()) {
      if (d.offer) {
        lines.push({
          type: "Feature",
          properties: { kind: "offer" },
          geometry: { type: "LineString", coordinates: [[d.lon, d.lat], [d.offer.pickupLon, d.offer.pickupLat]] },
        });
      }
    }
    for (const b of sim.db.bookings.values()) {
      const driver = b.driverId === undefined ? undefined : sim.drivers.get(b.driverId);
      if (b.status === "CONFIRMED" && driver) {
        lines.push({
          type: "Feature",
          properties: { kind: "trip" },
          geometry: { type: "LineString", coordinates: [[driver.lon, driver.lat], [b.pickupLon, b.pickupLat]] },
        });
      }
    }

    const drivers: Feature[] = [...sim.drivers.values()].map((d) => {
      const state = !d.inIndex || !d.online ? "offline" : d.offer ? "offered" : sim.isDriverAvailable(d.id) ? "free" : "busy";
      return {
        type: "Feature",
        properties: { state, label: d.name },
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      };
    });

    const riders: Feature[] = [...sim.riders.values()].map((r) => ({
      type: "Feature",
      properties: { label: r.name },
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    }));

    (map.getSource("search") as GeoJSONSource).setData(collection(search));
    (map.getSource("lines") as GeoJSONSource).setData(collection(lines));
    (map.getSource("drivers") as GeoJSONSource).setData(collection(drivers));
    (map.getSource("riders") as GeoJSONSource).setData(collection(riders));
  }, [ready, sim, version]);

  return <div ref={container} className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-300 shadow-sm lg:h-[520px]" />;
}
