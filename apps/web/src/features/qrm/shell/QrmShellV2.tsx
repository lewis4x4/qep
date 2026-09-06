import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listQrmMoves, listQrmSignals } from "../lib/qrm-router-api";
import { useEffect, useState } from "react";
import { Activity, LayoutGrid, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { StatusDot } from "../components/command-deck";
import {
  resolveSurface,
  SURFACE_LENSES,
  SURFACE_ORDER,
  type SurfaceId,
  SURFACES,
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

const SURFACE_ICONS: Record<
  SurfaceId,
  React.ComponentType<{ className?: string }>
> = {
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
  const { profile } = useAuth();
  const { surface: activeSurface, lens: activeLens } = resolveSurface(pathname);
  const role = profile?.role as
    | "rep"
    | "admin"
    | "manager"
    | "owner"
    | undefined;
  const lenses = SURFACE_LENSES[activeSurface].filter((lens) =>
    !lens.roles || (role ? lens.roles.includes(role) : false)
  );
  const movesQuery = useQuery({
    queryKey: ["qrm", "today-moves", "mine", profile?.id ?? "anon"],
    queryFn: () => listQrmMoves({ statuses: ["suggested", "accepted"], limit: 100 }),
    enabled: Boolean(profile?.id), staleTime: 30_000, refetchInterval: 60_000,
  });
  const signalsQuery = useQuery({
    queryKey: ["qrm", "pulse-signals"],
    queryFn: () => listQrmSignals({ limit: 200 }),
    enabled: Boolean(profile?.id), staleTime: 30_000, refetchInterval: 60_000,
  });
  const counts: Partial<Record<SurfaceId, string>> = {};
  if (movesQuery.isSuccess) counts.today = `${movesQuery.data.length}${movesQuery.data.length >= 100 ? "+" : ""}`;
  if (signalsQuery.isSuccess) counts.pulse = `${signalsQuery.data.length}${signalsQuery.data.length >= 200 ? "+" : ""}`;
  const feedFailed = movesQuery.isError || signalsQuery.isError;
  const feedLoading = movesQuery.isPending || signalsQuery.isPending;
  const updatedAt = Math.min(movesQuery.dataUpdatedAt, signalsQuery.dataUpdatedAt);
  const now = useClock();
  const clock = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
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
          <span className="text-[10px] text-muted-foreground" role="status">
            {feedFailed ? "Queue counts unavailable" : feedLoading ? "Loading queues…" : `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </span>
          <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground sm:inline">
            {clock}
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
        className="relative flex min-w-0 max-w-full items-stretch overflow-x-auto border-b border-qep-deck-rule/70"
      >
        {SURFACE_ORDER.map((surfaceId) => {
          const def = SURFACES[surfaceId];
          const Icon = SURFACE_ICONS[surfaceId];
          const count = counts[surfaceId];
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
                  active ? "text-qep-orange-accessible" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
                {def.label}
              </span>
              {count != null && <span className="ml-1 rounded-sm bg-muted px-1 font-mono text-[10px]" title="Matching items in the current queue; + indicates additional items may exist">{count}</span>}
              <span
                className={cn(
                  "ml-1 hidden rounded-sm border px-1 font-mono text-[9px] font-semibold tabular-nums transition-colors md:inline-flex",
                  active
                    ? "border-qep-orange/30 text-qep-orange-accessible"
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
                    ? "border-qep-orange/60 bg-qep-orange/10 text-qep-orange-accessible shadow-[0_0_0_1px_hsl(var(--qep-orange)/0.3)_inset]"
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
