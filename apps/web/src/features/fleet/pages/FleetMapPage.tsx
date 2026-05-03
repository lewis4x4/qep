import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { MapWithSidebar, MapLibreCanvas, FilterBar, StatusChipStack, type FilterDef, type MapOverlay, type MapMarker } from "@/components/primitives";
import { Map as MapIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import {
  normalizeFleetEquipmentRows,
  normalizeFleetTelemetryRows,
  resolveFleetCoordinate,
  type FleetTelemetryRow,
} from "../lib/fleet-map-normalizers";

const FILTERS: FilterDef[] = [
  { key: "branch",   label: "Branch", type: "text" },
  { key: "make",     label: "Make",   type: "text" },
  { key: "customer", label: "Customer", type: "text" },
];

const DEFAULT_OVERLAYS: MapOverlay[] = [
  { key: "branch_territory",     label: "Branch territory",     enabled: true },
  { key: "customer_concentration", label: "Customer concentration", enabled: false },
  { key: "open_opportunities",   label: "Open opportunities",   enabled: false },
  { key: "idle_assets",          label: "Idle assets (7d+)",    enabled: false },
  { key: "service_routes",       label: "Service routes",       enabled: false },
];

export function FleetMapPage() {
  const navigate = useNavigate();
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);

  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ["fleet-map", "equipment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, name, make, model, year, engine_hours, company_id, metadata")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("Failed to load fleet");
      return normalizeFleetEquipmentRows(data);
    },
    staleTime: 60_000,
  });

  // Pull telematics feeds in parallel for lat/lng
  const { data: telemetry = [] } = useQuery({
    queryKey: ["fleet-map", "telematics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telematics_feeds")
        .select("equipment_id, last_lat, last_lng, last_reading_at")
        .not("last_lat", "is", null)
        .limit(5000);
      if (error) return [];
      return normalizeFleetTelemetryRows(data);
    },
    staleTime: 2 * 60_000,
  });

  // Build marker list: telematics wins, fall back to metadata.lat/lng
  const markers = useMemo<MapMarker[]>(() => {
    const telemByEquipment = new Map<string, FleetTelemetryRow>();
    for (const t of telemetry) telemByEquipment.set(t.equipment_id, t);

    return equipment.flatMap<MapMarker>((e) => {
      const t = telemByEquipment.get(e.id);
      const coordinate = resolveFleetCoordinate(e, t);
      if (!coordinate) return [];
      const titleParts = [e.year, e.make, e.model].filter(Boolean).join(" ") || e.name;
      const idleDays = t?.last_reading_at
        ? (Date.now() - new Date(t.last_reading_at).getTime()) / 86_400_000
        : null;
      return [{
        id: e.id,
        lat: coordinate.lat,
        lng: coordinate.lng,
        label: titleParts,
        tone: idleDays != null && idleDays > 7 ? "red" : "blue",
        onClick: () => navigate(`/equipment/${e.id}`),
      }];
    });
  }, [equipment, telemetry, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <div>
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Fleet</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Every machine across every customer. Toggle layers on the right.
        </p>
      </div>

      <MapWithSidebar
        sidebarHeader={
          <div className="space-y-2">
            <FilterBar filters={FILTERS} />
            <p className="text-[10px] text-muted-foreground">
              {isLoading ? "Loading…" : `${equipment.length} assets`}
            </p>
          </div>
        }
        sidebar={
          <div className="divide-y divide-border">
            {equipment.map((e) => {
              const titleParts = [e.year, e.make, e.model].filter(Boolean);
              const chips: Array<{ label: string; tone: "blue" | "orange" | "neutral" }> = [];
              if (e.engine_hours != null) chips.push({ label: `${Math.round(e.engine_hours)}h`, tone: "orange" });
              if (e.year) chips.push({ label: String(e.year), tone: "neutral" });
              return (
                <Link key={e.id} to={`/equipment/${e.id}`} className="block p-2 hover:bg-muted/30">
                  <p className="text-xs font-medium text-foreground truncate">
                    {titleParts.length > 0 ? titleParts.join(" ") : e.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{e.name}</p>
                  <div className="mt-1">
                    <StatusChipStack chips={chips} />
                  </div>
                </Link>
              );
            })}
            {!isLoading && equipment.length === 0 && (
              <Card className="m-2 p-3">
                <p className="text-xs text-muted-foreground">No equipment in your scope.</p>
              </Card>
            )}
          </div>
        }
        mapContent={
          markers.length > 0 ? (
            <MapLibreCanvas markers={markers} cluster />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <MapIcon className="mx-auto h-10 w-10 text-muted-foreground mb-3" aria-hidden />
                <p className="text-sm text-foreground">
                  {isLoading ? "Loading fleet…" : "No geolocated equipment yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-md">
                  Markers appear once telematics feeds report lat/lng or equipment metadata carries coordinates.
                </p>
              </div>
            </div>
          )
        }
        overlays={overlays}
        onOverlayToggle={(key, enabled) =>
          setOverlays((prev) => prev.map((o) => (o.key === key ? { ...o, enabled } : o)))
        }
      />
    </div>
  );
}
