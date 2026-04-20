import { NavLink, useLocation } from "react-router-dom";
import { Sparkles, LayoutGrid, Activity, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SURFACES,
  SURFACE_ORDER,
  SURFACE_LENSES,
  resolveSurface,
  type SurfaceId,
} from "./shellMap";

const SURFACE_ICONS: Record<SurfaceId, React.ComponentType<{ className?: string }>> = {
  today: Activity,
  graph: LayoutGrid,
  pulse: Radio,
  ask: Sparkles,
};

/**
 * QrmShellV2 — the 4-surface top nav that replaces the 25-tab horizontal
 * strip. Rendered in place of QrmSubNav on every QRM page when the
 * `shell_v2` feature flag is on.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Today   Graph   Pulse   Ask Iron                    │   <- surfaces
 *   ├──────────────────────────────────────────────────────┤
 *   │  [lens] [lens] [lens] [lens] ...                     │   <- secondary row
 *   └──────────────────────────────────────────────────────┘
 *
 * The active surface is inferred from the current pathname via `resolveSurface`
 * so the shell stays correct even when a user deep-links into a legacy route
 * (e.g. /qrm/competitive-threat-map → Pulse surface, Threat lens).
 */
export function QrmShellV2() {
  const { pathname } = useLocation();
  const { surface: activeSurface, lens: activeLens } = resolveSurface(pathname);
  const lenses = SURFACE_LENSES[activeSurface];

  return (
    <nav aria-label="QRM shell" className="mb-5">
      <div
        role="tablist"
        aria-label="QRM surfaces"
        className="flex items-center gap-1 border-b border-border"
      >
        {SURFACE_ORDER.map((surfaceId) => {
          const def = SURFACES[surfaceId];
          const Icon = SURFACE_ICONS[surfaceId];
          const active = surfaceId === activeSurface;
          return (
            <NavLink
              key={surfaceId}
              to={def.href}
              role="tab"
              aria-selected={active}
              title={def.description}
              className={cn(
                "group inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "border-b-2 border-qep-orange text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{def.label}</span>
            </NavLink>
          );
        })}
      </div>

      {lenses.length > 0 && (
        <div
          role="tablist"
          aria-label={`${SURFACES[activeSurface].label} lenses`}
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {lenses.map((lens) => {
            const active = lens.id === activeLens;
            return (
              <NavLink
                key={lens.id}
                to={lens.href}
                role="tab"
                aria-selected={active}
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150",
                  active
                    ? "border-qep-orange bg-qep-orange/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-qep-orange/60 hover:text-foreground"
                )}
              >
                {lens.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </nav>
  );
}
