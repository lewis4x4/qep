import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Map as MapIcon } from "lucide-react";
import { MapWithSidebar, StatusChipStack, type MapOverlay } from "@/components/primitives";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import { useState } from "react";

const PORTAL_OVERLAYS: MapOverlay[] = [
  { key: "service_status", label: "Service status", enabled: true },
  { key: "warranty",       label: "Warranty windows", enabled: false },
  { key: "service_routes", label: "Upcoming service visits", enabled: false },
];

interface PortalFleetItem {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  stage_label?: string | null;
}

/**
 * Customer-facing fleet map mirror. Reuses MapWithSidebar + StatusChipStack
 * primitives so the layout matches the internal /fleet view exactly. The
 * commercial overlay is hidden by RLS (see equipment_status_canonical view
 * in mig 161 — portal sees stage_label only, never internal columns).
 */
export function PortalFleetMapPage() {
  const [overlays, setOverlays] = useState<MapOverlay[]>(PORTAL_OVERLAYS);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "fleet-map"],
    queryFn: () => portalApi.getFleetWithStatus(),
    staleTime: 60_000,
  });

  const items = ((data?.fleet ?? []) as unknown as PortalFleetItem[]);

  return (
    <PortalLayout>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Your Fleet</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Every machine you own with us. Tap any to see live status, manuals, and service history.
        </p>
      </div>

      <MapWithSidebar
        sidebarHeader={
          <p className="text-[10px] text-muted-foreground">
            {isLoading ? "Loading…" : `${items.length} machines`}
          </p>
        }
        sidebar={
          <div className="divide-y divide-border">
            {items.map((e) => {
              const titleParts = [e.year, e.make, e.model].filter(Boolean);
              const chips: Array<{ label: string; tone: "blue" | "orange" | "neutral" }> = [];
              if (e.engine_hours != null) chips.push({ label: `${Math.round(e.engine_hours)}h`, tone: "orange" });
              if (e.stage_label && e.stage_label !== "Operational") {
                chips.push({ label: e.stage_label, tone: "blue" });
              }
              return (
                <Link key={e.id} to={`/portal/equipment/${e.id}`} className="block p-2 hover:bg-muted/30">
                  <p className="text-xs font-medium text-foreground truncate">
                    {titleParts.length > 0 ? titleParts.join(" ") : e.name}
                  </p>
                  <div className="mt-1">
                    <StatusChipStack chips={chips} />
                  </div>
                </Link>
              );
            })}
            {!isLoading && items.length === 0 && (
              <Card className="m-2 p-3">
                <p className="text-xs text-muted-foreground">
                  No equipment on file yet. Your dealer will add your machines as deliveries are recorded.
                </p>
              </Card>
            )}
            {isError && (
              <Card className="m-2 border-red-500/20 p-3">
                <p className="text-xs text-red-400">Couldn't load your fleet right now.</p>
              </Card>
            )}
          </div>
        }
        mapContent={
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MapIcon className="mx-auto h-10 w-10 text-muted-foreground mb-3" aria-hidden />
              <p className="text-sm text-foreground">Map view coming soon</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-md">
                We're rolling out the live map next. For now, use the list on the left.
              </p>
            </div>
          </div>
        }
        overlays={overlays}
        onOverlayToggle={(key, enabled) =>
          setOverlays((prev) => prev.map((o) => (o.key === key ? { ...o, enabled } : o)))
        }
      />
    </PortalLayout>
  );
}
