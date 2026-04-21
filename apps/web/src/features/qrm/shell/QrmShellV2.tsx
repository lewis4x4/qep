import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Activity, LayoutGrid, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot, LiveBadge } from "../components/command-deck";
import {
  SURFACES,
  SURFACE_ORDER,
  SURFACE_LENSES,
  resolveSurface,
  type SurfaceId,
} from "./shellMap";

/**
 * QrmShellV2 — four-surface operator command deck.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ QRM / OPERATOR DECK                          ● LIVE · 14:23 CT │  <- meta rail
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ [TODAY] · [GRAPH] · [PULSE] · [ASK IRON]            ⌘K search │  <- surfaces
 *   │─────────────────── (hairline underline)                         │
 *   │ DEALS   CONTACTS   COMPANIES   INVENTORY   RENTALS   …          │  <- lenses
 *   └────────────────────────────────────────────────────────────────┘
 */

const SURFACE_ICONS: Record<SurfaceId, React.ComponentType<{ className?: string }>> = {
  today: Activity,
  graph: LayoutGrid,
  pulse: Radio,
  ask: Sparkles,
};

/**
 * Keyboard-hint glyph shown next to each surface. Purely visual today —
 * actual keybindings land in a follow-on slice.
 */
const SURFACE_HINT: Record<SurfaceId, string> = {
  today: "T",
  graph: "G",
  pulse: "P",
  ask: "A",
};

/**
 * Live pulse counts per surface. These are placeholders wired to the shell
 * today; subsequent slices will subscribe to the actual signal counts from
 * the activity / pulse / inventory streams.
 */
const SURFACE_SIGNAL: Record<SurfaceId, { count: number; tone: "active" | "live" | "hot" | "cool" }> = {
  today: { count: 7, tone: "active" },
  graph: { count: 0, tone: "cool" },
  pulse: { count: 12, tone: "hot" },
  ask: { count: 0, tone: "live" },
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function QrmShellV2() {
  const { pathname } = useLocation();
  const { surface: activeSurface, lens: activeLens } = resolveSurface(pathname);
  const lenses = SURFACE_LENSES[activeSurface];
  const now = useClock();
  const clock = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <nav aria-label="QRM shell" className="mb-5 space-y-2">
      {/* ─────────────── META RAIL ─────────────── */}
      <div className="flex items-center justify-between px-0.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <span className="text-foreground/80">QRM</span>
          <span className="mx-1.5 text-qep-deck-rule">/</span>
          <span>Operator Deck</span>
        </p>
        <div className="flex items-center gap-3">
          <LiveBadge />
          <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground sm:inline">
            {clock} CT
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:inline">
            ⌘K
          </span>
        </div>
      </div>

      {/* ─────────────── SURFACE STRIP ─────────────── */}
      <div
        role="tablist"
        aria-label="QRM surfaces"
        className="relative flex items-stretch border-b border-qep-deck-rule/70"
      >
        {SURFACE_ORDER.map((surfaceId) => {
          const def = SURFACES[surfaceId];
          const Icon = SURFACE_ICONS[surfaceId];
          const signal = SURFACE_SIGNAL[surfaceId];
          const active = surfaceId === activeSurface;
          return (
            <NavLink
              key={surfaceId}
              to={def.href}
              role="tab"
              aria-selected={active}
              title={def.description}
              className={cn(
                "group relative inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-colors",
                  active ? "text-qep-orange" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
                {def.label}
              </span>
              {signal.count > 0 && (
                <span
                  className={cn(
                    "ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-sm px-1 font-mono text-[10px] font-semibold tabular-nums",
                    signal.tone === "hot"
                      ? "bg-qep-hot/15 text-qep-hot"
                      : signal.tone === "live"
                        ? "bg-qep-live/15 text-qep-live"
                        : signal.tone === "active"
                          ? "bg-qep-orange/15 text-qep-orange"
                          : "bg-muted text-muted-foreground",
                  )}
                >
                  {signal.count}
                </span>
              )}
              <span
                className={cn(
                  "ml-1 hidden rounded-sm border px-1 font-mono text-[9px] font-semibold tabular-nums transition-colors md:inline-flex",
                  active
                    ? "border-qep-orange/30 text-qep-orange/80"
                    : "border-qep-deck-rule text-muted-foreground/60",
                )}
              >
                {SURFACE_HINT[surfaceId]}
              </span>
              {/* Active underline glow */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-qep-orange shadow-[0_0_10px_hsl(var(--qep-orange)/0.6)]"
                />
              )}
            </NavLink>
          );
        })}
      </div>

      {/* ─────────────── LENS ROW ─────────────── */}
      {lenses.length > 0 && (
        <div
          role="tablist"
          aria-label={`${SURFACES[activeSurface].label} lenses`}
          className="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span className="mr-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            Lens
          </span>
          {lenses.map((lens) => {
            const active = lens.id === activeLens;
            return (
              <NavLink
                key={lens.id}
                to={lens.href}
                role="tab"
                aria-selected={active}
                className={cn(
                  "group inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] transition-all duration-150",
                  active
                    ? "border-qep-orange/60 bg-qep-orange/10 text-qep-orange shadow-[0_0_0_1px_hsl(var(--qep-orange)/0.3)_inset]"
                    : "border-qep-deck-rule/70 text-muted-foreground hover:border-qep-orange/40 hover:bg-qep-orange/5 hover:text-foreground",
                )}
              >
                {active && <StatusDot tone="active" size="xs" />}
                <span>{lens.label}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </nav>
  );
}
