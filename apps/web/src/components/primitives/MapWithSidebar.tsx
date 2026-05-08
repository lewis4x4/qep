import { type ReactNode, useState } from "react";
import { Card } from "@/components/ui/card";
import { Map as MapIcon, Layers, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

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
  /** Opt-in mobile behavior: render sidebar as a bottom sheet on small screens. */
  mobileSidebarMode?: "sidebar" | "bottom-sheet";
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
  sidebar,
  sidebarHeader,
  mapContent,
  overlays = [],
  onOverlayToggle,
  mobileSidebarMode = "sidebar",
  className = "",
}: MapWithSidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const useMobileBottomSheet = mobileSidebarMode === "bottom-sheet";

  return (
    <div className={`relative flex h-[calc(100vh-12rem)] gap-0 ${className}`}>
      {/* Sidebar */}
      <aside
        className={useMobileBottomSheet
          ? `absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden border-t border-border bg-card shadow-xl transition-all sm:static sm:inset-auto sm:z-auto sm:border-r sm:border-t-0 sm:shadow-none ${
            sidebarOpen ? "max-h-[70%] rounded-t-xl sm:max-h-none sm:w-80 sm:rounded-none" : "max-h-0 sm:max-h-none sm:w-0"
          }`
          : `flex flex-col overflow-hidden border-r border-border bg-card transition-all ${
            sidebarOpen ? "w-full sm:w-80" : "w-0"
          }`}
      >
        {sidebarHeader && (
          <div className="border-b border-border p-2">{sidebarHeader}</div>
        )}
        <div className={useMobileBottomSheet ? "flex-1 overflow-y-auto pb-3 sm:pb-0" : "flex-1 overflow-y-auto"}>{sidebar}</div>
      </aside>

      {useMobileBottomSheet ? (
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className={`absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-3 text-muted-foreground shadow-sm hover:text-foreground sm:hidden ${
            sidebarOpen ? "bottom-[calc(70%_-_1.5rem)] h-9" : "bottom-3 h-11"
          }`}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/50" aria-hidden />
          {sidebarOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          <span className="text-[11px] font-medium">Signals</span>
        </button>
      ) : null}

      {/* Sidebar collapse toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        className={`absolute z-10 items-center justify-center rounded-r-md border border-l-0 border-border bg-card text-muted-foreground hover:text-foreground ${
          useMobileBottomSheet ? "hidden h-10 w-9 sm:flex" : "flex h-10 w-9"
        }`}
        style={{ left: sidebarOpen ? "20rem" : 0, top: "50%", transform: "translateY(-50%)" }}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Map */}
      <div className="relative flex-1 bg-muted/20">
        {mapContent || (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MapIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">Map provider not configured</p>
            </div>
          </div>
        )}

        {/* Overlay panel */}
        {overlays.length > 0 && (
          <Card className="absolute right-3 top-3 z-10 p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <Layers className="h-3 w-3 text-muted-foreground" aria-hidden />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Layers</p>
            </div>
            <div className="space-y-1">
              {overlays.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-foreground">
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
