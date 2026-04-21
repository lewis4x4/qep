/**
 * Command Deck Primitives
 *
 * Shared atoms for the QRM operator command-deck aesthetic:
 *   - StatusDot       pulsing/static signal indicator
 *   - SignalChip      monospaced label + value chip
 *   - MetricCell      large number + caption + optional delta
 *   - SectionCrumb    monospaced "GRAPH / CONTACTS" breadcrumb
 *   - IronBar         AI narrative ribbon pinned atop a surface
 *   - DeckDivider     hairline rule, optionally labelled
 *   - LiveBadge       glowing "LIVE" dot for realtime surfaces
 *
 * Design language:
 *   - Orange reserved for actionable/urgent signal.
 *   - Electric cyan (qep-live) reserved for AI / realtime / reasoning.
 *   - Monospaced metadata so counts and codes line up in grids.
 *   - Hairline borders, not rounded card shadows. Depth via inner glow.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  StatusDot                                                                  */
/* -------------------------------------------------------------------------- */

export type StatusTone =
  | "live"      // cyan — AI/realtime
  | "hot"       // crimson-orange — urgent/breach
  | "warm"      // amber — attention
  | "cool"      // slate — cold/inactive
  | "active"    // orange — primary active state
  | "ok";       // green — healthy

const TONE_DOT: Record<StatusTone, string> = {
  live: "bg-qep-live shadow-[0_0_10px_hsl(var(--qep-live))]",
  hot: "bg-qep-hot shadow-[0_0_8px_hsl(var(--qep-hot)/0.7)]",
  warm: "bg-qep-warm",
  cool: "bg-qep-cold",
  active: "bg-qep-orange shadow-[0_0_8px_hsl(var(--qep-orange)/0.6)]",
  ok: "bg-success",
};

export function StatusDot({
  tone = "cool",
  pulse = false,
  size = "sm",
  className,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const sizeCls = size === "xs" ? "h-1.5 w-1.5" : size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block rounded-full",
        sizeCls,
        TONE_DOT[tone],
        pulse && "deck-pulse",
        className,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  LiveBadge — "LIVE" cyan pill with pulsing dot                              */
/* -------------------------------------------------------------------------- */

export function LiveBadge({ label = "LIVE", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-qep-live/40 bg-qep-live/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-qep-live",
        className,
      )}
    >
      <StatusDot tone="live" pulse size="xs" />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  SectionCrumb — "GRAPH / CONTACTS · 847"                                    */
/* -------------------------------------------------------------------------- */

export function SectionCrumb({
  surface,
  lens,
  count,
  className,
}: {
  surface: string;
  lens?: string;
  count?: number | string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      <span className="text-foreground/80">{surface}</span>
      {lens && (
        <>
          <span className="mx-1.5 text-qep-deck-rule">/</span>
          <span className="text-qep-orange">{lens}</span>
        </>
      )}
      {count !== undefined && (
        <>
          <span className="mx-2 text-qep-deck-rule">·</span>
          <span className="tabular-nums text-foreground/70">
            {typeof count === "number" ? count.toLocaleString() : count}
          </span>
        </>
      )}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  SignalChip — monospaced pill for status/diagnostic information             */
/* -------------------------------------------------------------------------- */

export function SignalChip({
  label,
  value,
  tone,
  icon: Icon,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  tone?: StatusTone;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const toneCls =
    tone === "live"
      ? "border-qep-live/30 bg-qep-live/5 text-qep-live"
      : tone === "hot"
        ? "border-qep-hot/40 bg-qep-hot/10 text-qep-hot"
        : tone === "warm"
          ? "border-qep-warm/40 bg-qep-warm/10 text-qep-warm"
          : tone === "active"
            ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange"
            : tone === "ok"
              ? "border-success/40 bg-success/10 text-success"
              : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]",
        toneCls,
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      <span>{label}</span>
      {value !== undefined && (
        <span className="ml-0.5 tabular-nums font-semibold text-foreground">{value}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  MetricCell — large number + caption + delta                                */
/* -------------------------------------------------------------------------- */

export function MetricCell({
  label,
  value,
  delta,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: { value: number | string; direction: "up" | "down" | "flat" };
  tone?: StatusTone;
  className?: string;
}) {
  const toneCls =
    tone === "hot"
      ? "text-qep-hot"
      : tone === "live"
        ? "text-qep-live"
        : tone === "active"
          ? "text-qep-orange"
          : "text-foreground";
  const DeltaIcon =
    delta?.direction === "up"
      ? ArrowUpRight
      : delta?.direction === "down"
        ? ArrowDownRight
        : Minus;
  const deltaTone =
    delta?.direction === "up"
      ? "text-success"
      : delta?.direction === "down"
        ? "text-qep-hot"
        : "text-muted-foreground";

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono text-xl font-semibold tabular-nums leading-none", toneCls)}>
          {value}
        </span>
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums", deltaTone)}>
            <DeltaIcon className="h-3 w-3" aria-hidden />
            {delta.value}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  MetricStrip — horizontal rail of MetricCells with hairline dividers        */
/* -------------------------------------------------------------------------- */

export function MetricStrip({
  cells,
  className,
}: {
  cells: Array<React.ComponentProps<typeof MetricCell>>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-md border border-qep-deck-rule bg-qep-deck-elevated/60 px-4 py-2.5",
        "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
        "divide-x divide-qep-deck-rule/50",
        className,
      )}
    >
      {cells.map((cell, i) => (
        <div key={`${cell.label}-${i}`} className={cn(i > 0 && "pl-3")}>
          <MetricCell {...cell} />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  IronBar — AI narrative ribbon, pinned atop a page                          */
/* -------------------------------------------------------------------------- */

export interface IronBarAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export function IronBar({
  headline,
  actions,
  className,
}: {
  headline: React.ReactNode;
  actions?: IronBarAction[];
  className?: string;
}) {
  return (
    <div
      aria-label="Iron briefing"
      className={cn(
        "relative flex items-center gap-3 overflow-hidden rounded-sm border border-qep-live/25 bg-gradient-to-r from-qep-live/[0.06] via-transparent to-qep-orange/[0.04] px-3 py-2",
        className,
      )}
    >
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-qep-live/40 bg-qep-live/10">
        <Sparkles className="h-3 w-3 text-qep-live" aria-hidden />
      </span>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
        Iron
      </span>
      <span className="hidden h-4 w-px bg-qep-deck-rule sm:inline-block" />
      <div className="min-w-0 flex-1 truncate text-sm text-foreground/90">{headline}</div>
      {actions && actions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {actions.map((action) => {
            const content = (
              <span className="inline-flex items-center gap-1 rounded-sm border border-qep-live/30 bg-qep-live/10 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-qep-live transition-colors hover:bg-qep-live/20">
                {action.label}
              </span>
            );
            if (action.href) {
              return (
                <a key={action.label} href={action.href}>
                  {content}
                </a>
              );
            }
            return (
              <button key={action.label} type="button" onClick={action.onClick}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  DeckDivider — hairline rule, optionally with a label inset                 */
/* -------------------------------------------------------------------------- */

export function DeckDivider({ label, className }: { label?: string; className?: string }) {
  if (!label) {
    return <div className={cn("h-px w-full bg-qep-deck-rule/60", className)} />;
  }
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="h-px flex-1 bg-qep-deck-rule/60" />
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-qep-deck-rule/60" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  DeckSurface — the elevated card-like container for dense data              */
/* -------------------------------------------------------------------------- */

export function DeckSurface({
  children,
  className,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "live";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-qep-deck-elevated/70 backdrop-blur-sm",
        tone === "live"
          ? "border-qep-live/25 deck-glow-live"
          : "border-qep-deck-rule deck-glow",
        className,
      )}
    >
      {children}
    </div>
  );
}
