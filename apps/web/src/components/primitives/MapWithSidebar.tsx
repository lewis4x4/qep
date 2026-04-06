import { type ReactNode, useState } from "react";
import { Card } from "@/components/ui/card";
import { Map as MapIcon, Layers, ChevronLeft, ChevronRight } from "lucide-react";

export interface MapOverlay {
  key: string;
  label: string;
  enabled: boolean;
}

interface MapWithSidebarProps {
  /** Sidebar list content (e.g. asset rows) */
  sidebar: ReactNode;
  /** Optional sidebar header (filter bar, search, etc.) */
  sidebarHeader?: ReactNode;
  /** Map content — pass a Mapbox/MapLibre wrapper as children */
  mapContent: ReactNode;
  /** Toggleable overlays for the layer panel */
  overlays?: MapOverlay[];
  onOverlayToggle?: (key: string, enabled: boolean) => void;
  className?: string;
}

/**
 * Two-panel map layout: scrollable list on the left (mobile: collapsible
 * drawer), map on the right with a layer-toggle panel. Used by both
 * /fleet (internal) and /portal/fleet (customer-facing) so the layout
 * lives in one place.
 *
 * Map rendering itself (Mapbox/MapLibre) is provided by the caller —
 * this primitive is layout + overlay management only, so the rest of
 * Phase 3 doesn't need a Mapbox token to ship.
 */
export function MapWithSidebar({
  sidebar, sidebarHeader, mapContent, overlays = [], onOverlayToggle, className = "",
}: MapWithSidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className={`relative flex h-[calc(100vh-12rem)] gap-0 ${className}`}>
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-border bg-card transition-all ${
          sidebarOpen ? "w-full sm:w-80" : "w-0"
        } overflow-hidden`}
      >
        {sidebarHeader && (
          <div className="border-b border-border p-2">{sidebarHeader}</div>
        )}
        <div className="flex-1 overflow-y-auto">{sidebar}</div>
      </aside>

      {/* Sidebar collapse toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-r-md border border-l-0 border-border bg-card p-1 text-muted-foreground hover:text-foreground"
        style={{ left: sidebarOpen ? "20rem" : 0 }}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Map */}
      <div className="relative flex-1 bg-muted/20">
        {mapContent || (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MapIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
              <p className="text-xs text-muted-foreground">Map provider not configured</p>
            </div>
          </div>
        )}

        {/* Overlay panel */}
        {overlays.length > 0 && (
          <Card className="absolute right-3 top-3 z-10 p-2">
            <div className="flex items-center gap-1 mb-1.5">
              <Layers className="h-3 w-3 text-muted-foreground" aria-hidden />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Layers</p>
            </div>
            <div className="space-y-1">
              {overlays.map((o) => (
                <label key={o.key} className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={o.enabled}
                    onChange={(e) => onOverlayToggle?.(o.key, e.target.checked)}
                    className="h-3 w-3"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
