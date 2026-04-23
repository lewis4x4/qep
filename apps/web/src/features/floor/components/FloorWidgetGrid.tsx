/**
 * FloorWidgetGrid — the composable widget surface.
 *
 * Resolves every widget id in the layout against the Floor registry and
 * drops anything unknown (forward-compat for stale layouts). Widgets that
 * resolve to `size: "wide"` span two columns on large screens; `normal`
 * widgets span one.
 *
 * Empty-state: if the layout has zero widgets, renders a tasteful
 * empty-state that tells admins how to compose one (and says nothing to
 * non-admins beyond "your Floor is empty").
 */
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { resolveFloorWidget } from "../lib/floor-widget-registry";
import type { FloorLayoutWidget } from "../lib/layout-types";

export interface FloorWidgetGridProps {
  widgets: FloorLayoutWidget[];
  isAdmin: boolean;
}

export function FloorWidgetGrid({ widgets, isAdmin }: FloorWidgetGridProps) {
  const resolved = widgets
    .map((w) => ({ ...w, descriptor: resolveFloorWidget(w.id) }))
    .filter((w): w is FloorLayoutWidget & { descriptor: NonNullable<ReturnType<typeof resolveFloorWidget>> } => !!w.descriptor);

  if (resolved.length === 0) {
    return <FloorEmptyState isAdmin={isAdmin} />;
  }

  return (
    <div className="flex-1 px-4 pb-6 pt-4 sm:px-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {resolved.map((w, i) => {
          const Component = w.descriptor.component;
          // Stagger fade-in for page load — 20ms per widget, starts at 60ms.
          const delay = 60 + i * 20;
          return (
            <div
              key={`${w.id}-${i}`}
              style={{ animationDelay: `${delay}ms` }}
              className={[
                "animate-page-in",
                w.descriptor.size === "wide"
                  ? "md:col-span-2 xl:col-span-2"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Component />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FloorEmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="max-w-sm text-center">
        <Sparkles
          className="mx-auto h-8 w-8 text-[hsl(var(--qep-orange))]/70"
          aria-hidden="true"
        />
        <p className="mt-3 font-display text-2xl tracking-[0.04em] text-foreground">
          YOUR FLOOR IS EMPTY
        </p>
        {isAdmin ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              No widgets added for this role yet. Compose a layout to seed
              the Floor — each role is capped at six widgets, so pick
              the ones that matter.
            </p>
            <Link
              to="/floor/compose"
              className="mt-4 inline-flex items-center rounded-md border border-[hsl(var(--qep-orange))] bg-[hsl(var(--qep-orange))]/10 px-4 py-2 font-kpi text-xs font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-orange))] transition-colors hover:bg-[hsl(var(--qep-orange))]/20"
            >
              Open composer
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Ask Brian to pick the widgets you need. The Floor will light up
            the moment he does.
          </p>
        )}
      </div>
    </div>
  );
}
