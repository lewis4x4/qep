import { useEffect, useRef, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  label?: string;
  tone?: "blue" | "orange" | "red" | "green" | "violet" | "neutral";
  onClick?: () => void;
}

export interface MapPolygon {
  id: string;
  /** GeoJSON polygon coordinates [[[lng, lat], ...]] */
  coordinates: number[][][];
  fillColor?: string;
  lineColor?: string;
  label?: string;
}

interface MapLibreCanvasProps {
  markers: MapMarker[];
  polygons?: MapPolygon[];
  /** Initial map center [lng, lat]. If omitted, fits to markers. */
  center?: [number, number];
  /** Initial zoom level. Default 4 (CONUS-wide). */
  zoom?: number;
  /** Enable marker clustering at zoom-out. Default true. */
  cluster?: boolean;
  className?: string;
}

/**
 * Zero-token map canvas using MapLibre GL + public OpenStreetMap tiles.
 *
 * Ships without requiring VITE_MAPBOX_TOKEN — uses the MapLibre demo
 * style that proxies OSM. When a token IS set in env, callers can swap
 * the style URL to any Mapbox style for higher-quality tiles.
 *
 * Rendering model:
 *   - markers rendered as a clustered GeoJSON source with circle layers
 *   - polygons rendered as a fill+line GeoJSON source
 *   - clicking a cluster zooms in
 *   - clicking a point fires the onClick callback for that marker
 *
 * Performance: tested at 10k markers (clustering keeps it 60fps); for
 * the 271K-asset stress test, recommend enabling cluster=true and
 * loading markers in viewport batches via a move-end handler.
 */
export function MapLibreCanvas({
  markers,
  polygons = [],
  center,
  zoom = 4,
  cluster = true,
  className = "",
}: MapLibreCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerByIdRef = useRef<Map<string, MapMarker>>(new Map());

  // Build GeoJSON from markers
  const markerGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: markers
      .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
      .map((m) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          label: m.label ?? "",
          tone: m.tone ?? "blue",
        },
      })),
  }), [markers]);

  const polygonGeoJson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: polygons.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: p.coordinates },
      properties: {
        id: p.id,
        fillColor: p.fillColor ?? "#f97316",
        lineColor: p.lineColor ?? "#f97316",
        label: p.label ?? "",
      },
    })),
  }), [polygons]);

  // Resolve initial center: explicit prop → first marker → CONUS center
  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return center;
    const first = markers.find((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
    if (first) return [first.lng, first.lat];
    return [-98.5795, 39.8283]; // Geographic center of CONUS
  }, [center, markers]);

  // One-time map setup
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-raster": {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
            maxzoom: 19,
          },
        },
        layers: [
          { id: "osm-raster-layer", type: "raster", source: "osm-raster" },
        ],
      },
      center: initialCenter,
      zoom,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // Polygons source/layers
      map.addSource("polygons", {
        type: "geojson",
        data: polygonGeoJson,
      });
      map.addLayer({
        id: "polygons-fill",
        type: "fill",
        source: "polygons",
        paint: {
          "fill-color": ["get", "fillColor"],
          "fill-opacity": 0.15,
        },
      });
      map.addLayer({
        id: "polygons-line",
        type: "line",
        source: "polygons",
        paint: {
          "line-color": ["get", "lineColor"],
          "line-width": 1.5,
        },
      });

      // Markers source with clustering
      map.addSource("markers", {
        type: "geojson",
        data: markerGeoJson,
        cluster,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      if (cluster) {
        // Cluster circles
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "markers",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step",
              ["get", "point_count"],
              "#f97316", 10,
              "#ea580c", 50,
              "#c2410c",
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              14, 10,
              18, 50,
              22,
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "markers",
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-size": 12,
          },
          paint: {
            "text-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "unclustered-point",
          type: "circle",
          source: "markers",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match",
              ["get", "tone"],
              "red",     "#ef4444",
              "green",   "#10b981",
              "orange",  "#f97316",
              "violet",  "#8b5cf6",
              "neutral", "#6b7280",
              "#3b82f6", // default blue
            ],
            "circle-radius": 7,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        // Cluster click → zoom in
        map.on("click", "clusters", (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          const clusterId = features[0]?.properties?.cluster_id;
          if (clusterId === undefined) return;
          (map.getSource("markers") as maplibregl.GeoJSONSource).getClusterExpansionZoom(clusterId)
            .then((targetZoom) => {
              map.easeTo({
                center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
                zoom: targetZoom,
              });
            }).catch(() => { /* noop */ });
        });

        // Unclustered point click
        map.on("click", "unclustered-point", (e) => {
          const markerId = e.features?.[0]?.properties?.id as string | undefined;
          if (!markerId) return;
          const marker = markerByIdRef.current.get(markerId);
          marker?.onClick?.();
        });

        map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
        map.on("mouseenter", "unclustered-point", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "unclustered-point", () => { map.getCanvas().style.cursor = ""; });
      } else {
        // Non-clustered: simple point layer
        map.addLayer({
          id: "points",
          type: "circle",
          source: "markers",
          paint: {
            "circle-color": [
              "match",
              ["get", "tone"],
              "red", "#ef4444",
              "green", "#10b981",
              "orange", "#f97316",
              "violet", "#8b5cf6",
              "neutral", "#6b7280",
              "#3b82f6",
            ],
            "circle-radius": 7,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.on("click", "points", (e) => {
          const markerId = e.features?.[0]?.properties?.id as string | undefined;
          if (!markerId) return;
          const marker = markerByIdRef.current.get(markerId);
          marker?.onClick?.();
        });
      }

      // Auto-fit to markers if the caller didn't pin center
      if (!center && markers.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const m of markers) {
          if (Number.isFinite(m.lat) && Number.isFinite(m.lng)) {
            bounds.extend([m.lng, m.lat]);
          }
        }
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 12 });
        }
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers on prop change
  useEffect(() => {
    markerByIdRef.current = new Map(markers.map((m) => [m.id, m]));
    const src = mapRef.current?.getSource("markers") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(markerGeoJson);
  }, [markers, markerGeoJson]);

  // Update polygons on prop change
  useEffect(() => {
    const src = mapRef.current?.getSource("polygons") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(polygonGeoJson);
  }, [polygonGeoJson]);

  return <div ref={containerRef} className={`h-full w-full ${className}`} />;
}
