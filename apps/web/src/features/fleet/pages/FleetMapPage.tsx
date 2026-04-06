import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { MapWithSidebar, FilterBar, StatusChipStack, type FilterDef, type MapOverlay } from "@/components/primitives";
import { Map as MapIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface EquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  company_id: string;
  metadata: Record<string, unknown>;
}

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
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);

  const { data: equipment = [], isLoading } = useQuery({
    queryKey: ["fleet-map", "equipment"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { is: (c: string, v: null) => { order: (c: string, o: Record<string, boolean>) => { limit: (n: number) => Promise<{ data: EquipmentRow[] | null; error: unknown }> } } } };
      }).from("crm_equipment")
        .select("id, name, make, model, year, engine_hours, company_id, metadata")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw new Error("Failed to load fleet");
      return data ?? [];
    },
    staleTime: 60_000,
  });

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
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MapIcon className="mx-auto h-10 w-10 text-muted-foreground mb-3" aria-hidden />
              <p className="text-sm text-foreground">Map provider integration pending</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-md">
                MapWithSidebar is layout-only by design. Drop a Mapbox/MapLibre canvas here once
                <code className="mx-1 rounded bg-muted px-1">VITE_MAPBOX_TOKEN</code> is configured.
              </p>
            </div>
          </div>
        }
        overlays={overlays}
        onOverlayToggle={(key, enabled) =>
          setOverlays((prev) => prev.map((o) => (o.key === key ? { ...o, enabled } : o)))
        }
      />
    </div>
  );
}
