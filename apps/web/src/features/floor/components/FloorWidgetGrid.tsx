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
import { Cog } from "lucide-react";
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
          // Stagger fade-in for page load — 25ms per widget, starts at 80ms.
          // Uses the Floor's own keyframe so it picks up the dark-palette
          // animation tokens (vs. the generic page-in from index.css).
          const delay = 80 + i * 25;
          return (
            <div
              key={`${w.id}-${i}`}
              style={{ animationDelay: `${delay}ms` }}
              className={[
                "floor-widget-in",
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

/**
 * Slice: The Floor v2 — gear-mark empty state.
 * Replaces the generic sparkle with a branded SVG gear wheel. Same
 * mark used in the top bar + Back-to-Floor chip for visual coherence.
 */
function FloorEmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        {/* Orange gear icon, subtly spinning on page enter */}
        <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-[hsl(var(--qep-orange))]/10 blur-lg"
          />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-[hsl(var(--qep-orange))]/60 bg-[hsl(var(--qep-deck-elevated))]">
            <Cog className="h-7 w-7 text-[hsl(var(--qep-orange))]" aria-hidden="true" />
          </span>
        </div>
        <p className="font-display text-3xl tracking-[0.06em] text-foreground">
          THE FLOOR IS EMPTY
        </p>
        {isAdmin ? (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              No widgets on this role's Floor yet. Open the composer to
              arrange the tools this role needs — six max, so pick the
              ones that matter.
            </p>
            <Link
              to="/floor/compose"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--qep-orange))] bg-[hsl(var(--qep-orange))]/10 px-5 py-2.5 font-kpi text-xs font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-orange))] transition-all hover:bg-[hsl(var(--qep-orange))]/20 hover:shadow-[0_0_24px_-8px_hsl(var(--qep-orange))]"
            >
              Open composer
            </Link>
          </>
        ) : (
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Brian is still composing your Floor. It'll light up the moment
            he picks your widgets.
          </p>
        )}
      </div>
    </div>
  );
}
